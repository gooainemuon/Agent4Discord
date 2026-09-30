# a4d-ctl — 봇 실행 관리 (tmux · 자동 실행 · 예약 · 상단바 아이콘)

Linux(Ubuntu/GNOME)와 macOS를 지원합니다.

## 설치

```sh
# 사전 준비
#   Ubuntu: sudo apt install tmux gir1.2-ayatanaappindicator3-0.1
#   macOS : brew install tmux
npm install
node tools/a4d-ctl/a4d-ctl.mjs install    # 빌드 + a4d-ctl 명령 + 서비스 + 상단바 아이콘
```

`a4d-ctl` 명령은 `~/.local/bin`에 설치됩니다. 코드를 업데이트한 뒤에는 `install`을 다시 실행하세요(다시 빌드합니다).

## 사용법

| 명령 | 설명 |
|---|---|
| `a4d-ctl start` / `stop` / `restart` | 봇 시작 / 종료 / 재시작 |
| `a4d-ctl status` | 상태 보기 |
| `a4d-ctl attach` | 봇이 돌고 있는 tmux 터미널에 접속합니다. 나가려면 `Ctrl-b d`를 누르세요(봇은 계속 실행) |
| `a4d-ctl autostart on\|off` | 로그인할 때 자동 실행 |
| `a4d-ctl schedule set 09:00 18:00 weekdays` | 예약 설정 (`all`, `weekdays`, `weekends`, `mon,wed,fri`) |
| `a4d-ctl schedule on\|off` | 예약 켜기 / 끄기 |
| `a4d-ctl cancel-stop` | 진행 중인 예약 종료 취소 |

봇은 전용 tmux 서버(`tmux -L a4d`)에서 실행됩니다. 봇이 비정상 종료되면 tmux 창이 남아 있으니, `attach`로 들어가 오류를 확인할 수 있습니다.

## 예약 동작

- **정시 켜기**: 봇을 켭니다.
- **정시 끄기**: 활성 세션 채널에 "N분 뒤 종료" 안내를 [연장]·[지금 종료] 버튼과 함께 보냅니다. 안내 시간이 지난 뒤 Claude가 작업 중이면 작업이 끝날 때까지 기다렸다가 끕니다.
- **놓친 켜기** (예약 시각에 절전 중이었거나 전원이 꺼져 있었을 때): 아직 켜져 있어야 할 시간대라면 켜고 알림을 띄웁니다. 시간대가 이미 지났다면 건너뜁니다.
- **놓친 끄기**: 봇을 끄지 않습니다. 대신 [계속 켜두기]·[지금 끄기] 알림을 띄웁니다.
- 예약 시각보다 5분 넘게 늦으면 "놓친 것"으로 봅니다.

## 설정 (`~/.agent4discord/ctl.json`)

| 키 | 기본값 | 설명 |
|---|---|---|
| `missedThresholdMinutes` | 5 | 몇 분 넘게 늦으면 놓친 예약으로 볼지 |
| `stopNoticeMinutes` | 10 | 종료 안내 후 실제로 종료하기까지의 시간 |
| `maxIdleWaitMinutes` | 30 | 작업이 끝나기를 최대 몇 분 기다릴지 |
| `extendMinutes` | 60 | [연장] 버튼을 누르면 미룰 시간 |
| `keepAwake` | true | (macOS) 봇이 실행 중일 때 잠자기 방지 |

실행 기록은 `~/.agent4discord/ctl.log`에 남습니다.

## OS별 구현

| | Linux | macOS |
|---|---|---|
| 봇 서비스 | `~/.config/systemd/user/a4d-bot.service` | tmux 직접 실행 + `caffeinate` |
| 자동 실행 | 위 서비스 enable | `~/Library/LaunchAgents/com.agent4discord.autostart.plist` |
| 예약 | `a4d-schedule-{start,stop}.timer` | `com.agent4discord.schedule-{start,stop}.plist` |
| 상단바 | AppIndicator (`~/.config/autostart`) | 메뉴바 (`com.agent4discord.tray.plist`) |

제거: `a4d-ctl uninstall`
