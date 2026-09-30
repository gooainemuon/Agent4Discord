#!/usr/bin/env python3
"""Agent4Discord 상단바 메뉴 (Linux AppIndicator / macOS 메뉴바).

모든 동작은 a4d-ctl을 호출해서 처리한다. 트레이가 꺼져 있어도 자동 실행과 예약은 그대로 동작한다.
"""
import argparse
import json
import os
import subprocess
import sys
import threading
from datetime import datetime

if sys.platform.startswith("linux"):
    os.environ.setdefault("PYSTRAY_BACKEND", "appindicator")

import pystray  # noqa: E402
from PIL import Image, ImageDraw  # noqa: E402

POLL_SECONDS = 5
IS_MAC = sys.platform == "darwin"

COLORS = {
    "running": (67, 181, 129),   # green
    "pending": (250, 166, 26),   # amber: scheduled shutdown in progress
    "stopped": (128, 132, 142),  # gray
    "crashed": (240, 71, 71),    # red
}


def make_icon(state):
    size = 64
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    color = COLORS[state]
    draw.rounded_rectangle((6, 12, 58, 52), radius=12, outline=color, width=6)
    draw.ellipse((18, 26, 28, 36), fill=color)
    draw.ellipse((36, 26, 46, 36), fill=color)
    return img


def fmt_hm(iso):
    if not iso:
        return "-"
    d = datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone()
    return d.strftime("%m/%d %H:%M")


def fmt_since(iso):
    """Static start time, so the menu text doesn't change (and redraw) every minute."""
    if not iso:
        return ""
    d = datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone()
    same_day = d.date() == datetime.now().astimezone().date()
    return d.strftime("%H:%M부터" if same_day else "%m/%d %H:%M부터")


class Tray:
    def __init__(self, node, ctl):
        self.base = [node, ctl]
        self.status = {}
        self.busy = False
        self.stop_event = threading.Event()
        self.shown_state = None
        self.shown_menu = None
        self.icon = pystray.Icon("agent4discord", make_icon("stopped"), "Agent4Discord", self.build_menu())

    # --- a4d-ctl ----------------------------------------------------------

    def ctl(self, *args):
        return subprocess.run(self.base + list(args), capture_output=True, text=True)

    def run_action(self, *args):
        """Run an a4d-ctl command off the UI thread, then refresh."""
        def work():
            self.busy = True
            self.update_ui()
            try:
                res = self.ctl(*args)
                if res.returncode != 0:
                    self.error((res.stderr or res.stdout).strip() or "명령이 실패했어요.")
            finally:
                self.busy = False
                self.refresh()
        threading.Thread(target=work, daemon=True).start()

    def refresh(self):
        try:
            res = self.ctl("status", "--json")
            self.status = json.loads(res.stdout) if res.returncode == 0 else {}
        except (OSError, ValueError):
            self.status = {}
        self.update_ui()

    def poll(self):
        while not self.stop_event.wait(POLL_SECONDS):
            self.refresh()

    # --- UI ---------------------------------------------------------------

    def on_ui_thread(self, fn):
        if IS_MAC:
            from PyObjCTools import AppHelper
            AppHelper.callAfter(fn)
        else:
            from gi.repository import GLib
            GLib.idle_add(lambda: (fn(), False)[1])

    def update_ui(self):
        st = self.status
        if st.get("pendingShutdown"):
            state = "pending"
        elif st.get("running"):
            state = "running"
        elif st.get("crashed"):
            state = "crashed"
        else:
            state = "stopped"

        # Only touch the indicator when something visible changed: every update
        # rebuilds the menu, which redraws (or closes) it while it is open.
        menu = (
            self.status_text(),
            self.schedule_text(),
            self.busy,
            bool(st.get("running")),
            bool(st.get("pendingShutdown")),
            bool(st.get("autostart")),
            bool((st.get("schedule") or {}).get("enabled")),
        )
        icon_changed = state != self.shown_state
        menu_changed = menu != self.shown_menu
        if not icon_changed and not menu_changed:
            return
        self.shown_state, self.shown_menu = state, menu

        def apply():
            if icon_changed:
                self.icon.icon = make_icon(state)
            if menu_changed:
                self.icon.update_menu()
        self.on_ui_thread(apply)

    def status_text(self, _item=None):
        st = self.status
        if self.busy:
            return "… 처리 중"
        if not st:
            return "상태를 확인할 수 없어요"
        if st.get("running"):
            text = f"● 실행 중 ({fmt_since(st.get('startedAt'))})"
            pending = st.get("pendingShutdown")
            if pending:
                text += f" — {fmt_hm(pending['at'])} 종료 예정"
            return text
        if st.get("crashed"):
            return "✕ 비정상 종료됨 — 터미널에서 오류 확인"
        return "○ 중지됨"

    def schedule_text(self, _item=None):
        s = self.status.get("schedule") or {}
        if not s:
            return "예약 사용"
        text = f"예약 사용 ({s.get('daysLabel')} {s.get('start')}~{s.get('stop')})"
        if s.get("enabled") and s.get("nextStart"):
            text += f" · 다음 켜기 {fmt_hm(s['nextStart'])}"
        return text

    def running(self, _item=None):
        return bool(self.status.get("running"))

    def build_menu(self):
        item = pystray.MenuItem
        idle = lambda _i: not self.busy  # noqa: E731
        return pystray.Menu(
            item(self.status_text, None, enabled=False),
            pystray.Menu.SEPARATOR,
            item("시작", lambda: self.run_action("start"), visible=lambda i: not self.running(i), enabled=idle),
            item("중지", lambda: self.run_action("stop"), visible=self.running, enabled=idle),
            item("재시작", lambda: self.run_action("restart"), visible=self.running, enabled=idle),
            item(
                "예약 종료 취소",
                lambda: self.run_action("cancel-stop"),
                visible=lambda _i: bool(self.status.get("pendingShutdown")),
            ),
            item("터미널 열기 (tmux)", lambda: self.run_action("open-terminal")),
            pystray.Menu.SEPARATOR,
            item(
                "로그인 시 자동 실행",
                lambda: self.run_action("autostart", "off" if self.status.get("autostart") else "on"),
                checked=lambda _i: bool(self.status.get("autostart")),
            ),
            item(
                self.schedule_text,
                lambda: self.run_action(
                    "schedule", "off" if (self.status.get("schedule") or {}).get("enabled") else "on"
                ),
                checked=lambda _i: bool((self.status.get("schedule") or {}).get("enabled")),
            ),
            item("예약 시간 설정…", lambda: threading.Thread(target=self.edit_schedule, daemon=True).start()),
            pystray.Menu.SEPARATOR,
            item("상단바 아이콘 닫기", self.quit),
        )

    # --- Dialogs ----------------------------------------------------------

    def error(self, message):
        if IS_MAC:
            subprocess.run(["osascript", "-e", f"display alert \"Agent4Discord\" message {applescript_str(message)}"])
        else:
            subprocess.run(["zenity", "--error", "--title=Agent4Discord", "--no-markup", f"--text={message}"])

    def edit_schedule(self):
        s = self.status.get("schedule") or {"start": "09:00", "stop": "18:00", "daysLabel": "매일"}
        values = ask_schedule(s)
        if values:
            self.run_action("schedule", "set", *values)

    def quit(self):
        self.stop_event.set()
        self.icon.stop()

    def run(self):
        def setup(icon):
            icon.visible = True
            self.refresh()
            threading.Thread(target=self.poll, daemon=True).start()
        self.icon.run(setup)


def applescript_str(s):
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


DAY_CHOICES = ["매일", "평일", "주말"]


def ask_schedule(current):
    """Return (start, stop, days) or None when cancelled."""
    if IS_MAC:
        def prompt(label, default):
            res = subprocess.run(
                ["osascript", "-e",
                 f"text returned of (display dialog {applescript_str(label)} default answer "
                 f"{applescript_str(default)} with title \"Agent4Discord 예약\")"],
                capture_output=True, text=True,
            )
            return res.stdout.strip() if res.returncode == 0 else None

        start = prompt("봇을 켤 시간 (HH:MM)", current["start"])
        if not start:
            return None
        stop = prompt("봇을 끌 시간 (HH:MM)", current["stop"])
        if not stop:
            return None
        default = current.get("daysLabel") if current.get("daysLabel") in DAY_CHOICES else "매일"
        choices = "{" + ", ".join(applescript_str(c) for c in DAY_CHOICES) + "}"
        res = subprocess.run(
            ["osascript", "-e",
             f"choose from list {choices} with title \"Agent4Discord 예약\" with prompt \"요일\" "
             f"default items {{{applescript_str(default)}}}"],
            capture_output=True, text=True,
        )
        days = res.stdout.strip()
        if res.returncode != 0 or days in ("", "false"):
            return None
        return start, stop, days

    res = subprocess.run(
        [
            "zenity", "--forms", "--title=Agent4Discord 예약",
            f"--text=봇을 켜고 끌 시간 (HH:MM)\n현재: {current.get('daysLabel')} {current['start']} ~ {current['stop']}",
            "--add-entry=켜는 시간", "--add-entry=끄는 시간",
            "--add-combo=요일", "--combo-values=" + "|".join(DAY_CHOICES),
            "--separator=|",
        ],
        capture_output=True, text=True,
    )
    if res.returncode != 0:
        return None
    start, stop, days = (res.stdout.strip().split("|") + ["", "", ""])[:3]
    return start.strip() or current["start"], stop.strip() or current["stop"], days.strip() or "매일"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--node", required=True)
    parser.add_argument("--ctl", required=True)
    args = parser.parse_args()
    Tray(args.node, args.ctl).run()


if __name__ == "__main__":
    main()
