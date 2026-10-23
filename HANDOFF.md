# HANDOFF

## 2026-10-20 14:28 — 상태 갱신: 두 총괄이 지침 변경을 커밋함, 앱 레인 이름은 그대로
**목표**: 14:03 항목과 같음(봇이 명부 기준으로 인박스 전달).
**한 것**:
- 코드 변경 없음. main = origin `d34aace`. 봇 실행 중(pid 24099, 13:36 시작).
- 두 총괄이 다른 레포 지침 변경을 커밋함(push 여부 미확인): supertonic3 `8b454c0` chore: Agent4Discord bot watches inbox for Discord sessions, muon `4e51390` chore(a4d): bot watches inbox via roster; ….
**남은 것** (우선순위 순):
1. muon 앱 레인: 14:28 에도 guild 파일(`~/.agent4discord/guilds/1554777181920436266.json`) 세션명 `estts-앱`, 감시 커서 없음. 사용자는 "확인함" 이라 함. 그 채널에서 `너는 esptts-앱` 뒤 `/a4d inbox status` 로 확인. 이름 붙이는 곳 `src/bot.ts:173` 부근.
2. muon 14:02 `연구노트-esptts-총괄-세션명바꿈.md` 내용 미확인. 명부가 바뀌었으면 해당 레인 `/a4d inbox on`.
3. reviewer "고치면 좋은 것" — 14:03 항목 남은 것 4번 그대로(`src/sessions/inboxWatch.ts` persist 부터).
**막힌 것 / 결정 필요**: 없음(붙여 쓴 낱말 미처리 결정은 14:03 항목대로 유지 추천).
**주의**: 14:03 항목의 주의 그대로. 명부 변경은 감시 재시작 때만 반영.
**검증 방법**: `npx tsc --noEmit`, `npx vitest run`(236개). 감시 상태는 guild 파일 `inboxCursor`, 셸 루프는 `pgrep -fl 'watch_inbox|until new='`.

## 2026-10-20 14:03 — 명부 기준 인박스 전달 완성, 두 프로젝트를 봇 감시로 전환, 전부 push
**목표**: 레인 세션이 셸 감시 루프 없이 봇에게서 `[A4D inbox]` 로 자기 앞 파일을 받습니다. 받는 레인은 인박스 README `## 세션` 명부로 정합니다. 프로젝트 설정은 `{"dir": ".planning/inbox", "roster": {}}` 한 줄입니다.

**한 것** (main = origin `d34aace`, tsc 통과, vitest 20파일 236개 통과):
- push `7c07ab4..93abd70`(지난 10커밋) → 봇 시작(12:19, 자동 `npm ci`+빌드) → 두 총괄에게 명부 요청 → 두 README 명부 완성(supertonic3 5레인, muon 7레인, 12:25~12:26).
- `d34aace` feat: `a4d-inbox.json` 에 `roster` 가 있으면 명부 기준. 파일명 `날짜[-HHMM[b]]-보낸이-받는이…-제목` 을 낱말 단위로(`-` 든 이름은 최장 일치) 명부 이름·이전 이름과 맞춤. hub(기본: 이름/이전 이름 `총괄`, 또는 `-총괄` 로 끝남)는 자기가 안 보낸 것 전부, 다른 레인은 받는이에 있거나 `전레인`. `src/sessions/roster.ts:63` laneNames, `:88` readMessageName, `src/sessions/inboxConfig.ts:97` loadRosterRoute, `:140` isForLane, `:113` readRoster(roster.ts 에서 옮김, 순환 import 방지). `/a4d inbox status` 표시 `src/commands/inbox.ts` rosterLine. README 두 곳. push 함(`93abd70..d34aace`).
- 다른 레포(커밋 안 함, 총괄에게 커밋 요청): 새 `~/ain/{supertonic3-distill,muon-micro-tts}/.claude/a4d-inbox.json`. supertonic3 `CLAUDE.md` 인박스 감시 항목 앞 한 줄, muon `.claude/CLAUDE.md` 세션 구성 첫 줄, 두 프로젝트 `.claude/a4d-on-resume.md` 2번: "봇이 감시를 알렸으면 루프 안 띄움, 앱 세션·명부 밖 이름만 예전 루프".
- 봇 재시작 13:36(pid 24099). 감시 9개 켜짐(guild 커서 13:36). 공지 파일 `…/2026-10-20-1336-a4d-봇인박스감시-시작-알림.md`(supertonic3), `…-1336-a4d-총괄-봇인박스감시-시작-알림.md`(muon) 이 13:36:46 두 총괄에게만 1회씩 전달됨(세션 JSONL 확인).

**남은 것** (우선순위 순):
1. muon 앱 레인: 사용자가 "확인함" 이라 했으나 14:03 기준 guild 파일(`~/.agent4discord/guilds/1554777181920436266.json`)의 세션명은 아직 `estts-앱`, 커서 없음(봇 감시 안 켜짐, 예전 `watch_inbox_앱.sh` 사용 중). 이름이 바뀌면 그 채널 `/a4d inbox status` 로 확인. 이름 변경 경로는 `src/bot.ts:173` 부근.
2. 두 총괄 회신 `봇 인박스 감시 확인 | 커밋 <해시>` 확인(다른 레포 지침 변경 커밋). 미확인.
3. muon 인박스에 14:02 `연구노트-esptts-총괄-세션명바꿈.md` 가 옴(내용 미확인). 명부 이름이 바뀌었으면 해당 채널에서 `/a4d inbox on` 으로 명부를 다시 읽어야 함(명부는 감시 시작 때만 읽음).
4. reviewer "고치면 좋은 것"(미착수): 폴링마다 guild JSON 다시 씀(`src/sessions/inboxWatch.ts` persist), off→on 때 밀린 파일 몰아 전달, mtime 커서라 `cp -p`/`rsync -a` 파일 놓침, 시작 절차보다 인박스 메시지가 먼저 갈 수 있음(`src/bot.ts:175`), glob `match` 의 `*`/`?`, 동적 파일명 자기 파일 미인식.

**막힌 것 / 결정 필요**:
- 레인 이름을 다른 말에 붙여 쓴 파일(`정규화기1차답`, `데이터셋D11빌드끝`, supertonic3 옛 파일 8개)은 일부러 안 잡음. 접두 일치를 넣으면 `앱`·`p4` 같은 짧은 이름이 오탐. 추천: 그대로 두고 파일명 규칙(두 README 첫머리에 적힘)으로 해결.

**주의**:
- 명부를 고친 뒤에는 해당 레인 채널에서 `/a4d inbox on`(또는 봇 재시작) 해야 반영됨.
- 다른 프로젝트의 `.planning/inbox/` 는 여러 세션이 함께 쓰는 원본. 넣을 때는 새 파일만. 파일명에 보낸이 `a4d` 를 맨 앞에 두면 hub 에게만 감(받는이 이름을 안 넣으면).
- 명부에 없는 세션명은 감시가 안 켜지고 프로젝트의 예전 루프를 씀(의도). 지침의 레인별 루프 지시를 지우지 말 것(앱 세션용).
- `a4d-ctl start/restart` 가 빌드까지 함. 같은 토큰을 두 기기에서 띄우지 말 것(미확인 위험).
- zsh 에서 `echo =====` 는 오류(`=` 확장). macOS 한글 집계는 `LC_ALL=C`.

**검증 방법**:
- `npx tsc --noEmit`, `npx vitest run` → 20파일 236개.
- 실제 파일 비교: scratchpad `compare.ts`, `check-lanes.ts`, `backlog.ts`(`/private/tmp/claude-501/-Users-gooaine-Agent4Discord/9e2a8208-3e58-45cf-a06d-7eafe184c719/scratchpad/`, 세션 끝나면 사라질 수 있음) — `npx tsx <파일>`.
- 감시 상태: guild 파일의 `activeSessions.*.inboxCursor`, 레인 채널 `/a4d inbox status`. 셸 루프 남았는지: `pgrep -fl 'watch_inbox|until new='`.
- 전달 확인: `grep -l <파일명> ~/.claude/projects/*/<세션ID>.jsonl`.

## 2026-10-20 12:13 — 리뷰 반영, a4d-ctl 자동 빌드, 세션 명부 경고, 동작 규칙을 레포 공통 파일로. 로컬 커밋 10개 앞섬, push·봇 시작 안 함
**목표**: 기기마다 봇이 따로 있어도(토큰은 기기별) 같은 설정·규칙으로 동작하고, pull 뒤 재시작만 하면 새 코드로 뜹니다. 인박스 전달이 턴 도중에 끼거나 파일을 놓치지 않습니다. 프로젝트마다 세션 명부(인박스 README `## 세션`)로 레인 이름을 관리합니다.

**한 것** (main, origin보다 10커밋 앞섬. 아래 7개가 이 세션 것. tsc 통과, vitest 20파일 230개 통과):
- `148f34f` fix: system 메시지(init/status/hook/task)마다 `idle` 로 바뀌던 것(MVP부터). 이제 `result` 만 idle(`src/sessions/sessionManager.ts:339`). reviewer 지적 #2.
- `9744d1a` fix: `/a4d clear` 뒤 이름 붙기 전에 온 인박스 파일이 사라지던 것. 커서가 없으면 세션 시작 시각부터 봄(`src/sessions/inboxWatch.ts:91`). reviewer 지적 #1.
- `0a8023a` + `4e6cd12`: `a4d-ctl start/restart` 가 시작 전에 `package-lock.json` 이 install보다 새로우면 `npm ci`, src/·tsconfig 가 `dist/cli.js` 보다 새로우면 `tsc --noEmitOnError`(`tools/a4d-ctl/lib/build.mjs:32` buildPlan, `:55` ensureBuilt, 호출 `tools/a4d-ctl/lib/bot.mjs:95` prepareBuild ← `:108` launchInTmux). 봇을 멈춘 뒤 빌드(봇이 lazy import). 빌드 실패 시 이전 dist로 경고와 함께 시작.
- `f4ab6c4` feat: 인박스 `README.md` 의 `## 세션` 절을 명부로 읽고(`src/sessions/roster.ts:28` parseRoster, `:65` readRoster, `:74` rosterWarning), `너는 X` 의 X가 명부에 없거나 이전 이름이면 채널에 경고(`src/bot.ts:177`). 줄 형식 `- <세션명>: <하는 일> (이전: a, b)` 또는 `, 이전 세션명 a, b`. 전달 규칙은 그대로.
- `9fd5701` feat: 레포 루트 `a4d.defaults.json` = 공통 동작 설정(opus, default, info, maxSessionsPerUser 100, autoResume true, toolThreadMode turn). 순서 코드 기본 < 공통 < 기기 config.json(`src/config.ts:37` REPO_DEFAULTS_PATH, `:61` loadConfig). 토큰·clientId·ownerIds 는 공통 파일에서 안 읽음. `--setup` 은 기기 값만 씀(`src/config.ts:102` saveConfig(DeviceConfig)).
- `93abd70` feat: 세션 규칙 `rules/discord.md`, `rules/handoff.md`(옛 `~/.claude/modes/` 내용, 기기 전용 경로 참조만 바꿈). 붙는 순서 레포 규칙 → `~/.claude/modes/discord.md`(기기 추가) → `<프로젝트>/.claude/modes/discord.md`(`src/sessions/sessionContext.ts:13`, `:21`). package.json `files` 에 두 경로 추가. README 두 곳 갱신.
- 이 PC 기기 파일 정리(사용자 승인): `~/.claude/modes/discord.md` 는 안내 주석만(백업 `.bak-20261020-121143`), `~/.agent4discord/config.json` 은 ownerIds·discordToken·discordClientId만(백업 `.bak-20261020-121143`, 600). 합쳐 읽은 값은 전과 같음 확인.

**남은 것** (우선순위 순):
1. 봇 시작: `node tools/a4d-ctl/a4d-ctl.mjs start`. 첫 시작에 `npm ci`(lock mtime 10-02 > install 10-01, 내용 변경 없음)와 빌드가 자동으로 돕니다. 봇은 10-20 10:39 KST부터 꺼져 있음(`~/.agent4discord/ctl.log`). 사용자 승인 필요.
2. 총괄에게 명부 요청 넣기(재시작 뒤): 초안이 scratchpad `/private/tmp/claude-501/-Users-gooaine-Agent4Discord/714fd67d-ba90-4bbb-a871-7d1921907421/scratchpad/requests/{supertonic3-distill,muon-micro-tts}/` 에 있음(scratchpad는 세션 끝나면 사라질 수 있음, 미확인). 파일명의 `HHMM` 을 실제 시각으로 바꿔 각 프로젝트 `.planning/inbox/` 에 새 파일로. 파일명은 각 프로젝트 규칙상 총괄에게만 가도록 검증함: supertonic3 `…-a4d-세션명부-README교체-요청.md`(이름에 "총괄" 없어야 증류-총괄이 받음), muon `…-a4d-총괄-세션명부-README교체-요청.md`. 재시작 전에 넣으면 세션의 셸 감시 루프가 켤 때 있던 파일로 쳐서 못 잡음.
3. push: 10커밋. 레포 `gooainemuon/Agent4Discord` 는 PUBLIC 이라 `rules/` 작업 규칙이 공개됨(비밀 없음 확인). 사용자 승인 필요.
4. 명부가 생긴 뒤: `.claude/a4d-inbox.json` 을 supertonic3-distill 과 muon-micro-tts 에 만들고, 각 프로젝트의 감시 루프 지시 정리(supertonic3 `CLAUDE.md` 19~22행, 두 프로젝트 `.claude/a4d-on-resume.md` 2번). 규칙 초안은 아래 11:42·12:10 항목. muon 초안은 실제 808개로 셸 기준과 6레인 모두 일치. esp-tts(muon으로 이전 끝)와 stt-llm-tts(supertonic3 옛 사본)는 규칙 불필요.
5. 명부 2단계: 받는 사람 판정을 명부 기준(파일명을 명부 이름으로 잘라 보낸이/받는이)으로 옮기기. 시작점 `src/sessions/inboxConfig.ts:81` isForLane, `src/sessions/roster.ts`.
6. reviewer "고치면 좋은 것"(미착수): 폴링마다 guild JSON 다시 씀(`src/sessions/inboxWatch.ts` persist), off→on 때 밀린 파일 몰아 전달, mtime 커서라 `cp -p`/`rsync -a` 파일 놓침, 시작 절차보다 인박스 메시지가 먼저 갈 수 있음(`src/bot.ts:173` 뒤 첨부 await), `{lane}` 부분 일치·`match` 의 `*`/`?`, 동적 파일명 자기 파일 미인식.

**막힌 것 / 결정 필요**:
- 1·3은 사용자 승인 대기(사용자가 이번엔 "1,2만 진행" = 기기 파일 정리만 승인). 추천: 봇 시작 → 요청 파일 넣기 → push.
- 지금 돌던 레인에 변경 공지 여부는 사용자가 정함.

**주의**:
- 다른 기기에서 쓰려면: pull → 그 기기 봇의 `~/.agent4discord/config.json`(토큰·clientId·ownerIds) → `a4d-ctl start`. 같은 토큰을 두 기기에서 동시에 띄우면 중복 응답 가능(봇에 막는 장치 있는지 미확인). 기기마다 다른 디스코드 앱을 쓰는 것이 사용자 의도.
- `~/.claude/modes/handoff.md` 는 앱 세션도 쓸 수 있어 그대로 둠. 공통판은 `rules/handoff.md`.
- 기기 `config.json` 에 동작 키를 다시 적으면 그 기기만 공통 값을 덮어씀.
- 다른 프로젝트의 `.planning/inbox/`, `.planning/handoff/` 는 다른 세션들이 함께 쓰는 원본. 읽기만 했음. 넣을 때는 새 파일만.
- macOS `uniq`/`sort` 는 한글을 뭉칠 수 있음. 파일명 집계는 `LC_ALL=C`.
- `npm run lint` 는 eslint 설정이 원래 없어 실패(무관).

**검증 방법**:
- `npx tsc --noEmit`, `npx vitest run` → 20파일 230개 통과.
- 자동 빌드: `node -e "import('./tools/a4d-ctl/lib/build.mjs').then(m=>console.log(m.buildPlan(process.cwd())))"` → 지금은 `{install:true, build:true}`, 시작 뒤에는 둘 다 false.
- 시작 뒤 `~/.agent4discord/ctl.log` 에 `prepared: install, build` 와 `started`. 
- 명부: 명부가 생긴 프로젝트 채널에서 없는 이름으로 `너는 X` → ⚠️ 경고 줄.
- 인박스 감시 시험은 아래 11:42 항목의 "검증 방법" 그대로.

---

## 2026-10-20 11:42 — 봇이 프로젝트 인박스를 감시, 인계 노트(.planning/handoff) 인식. 커밋 3개, push·재시작 안 함
**목표**: 레인 세션이 인박스 감시 루프(백그라운드 Bash/Monitor)를 직접 돌리지 않아도 됩니다. 봇이 `.planning/inbox/` 를 감시해 레인 앞으로 온 새 파일을 전하고, 재시작·resume·`/a4d clear` 뒤에도 감시가 이어집니다. `너는 <세션명>` 으로 시작하면 `.planning/handoff/` 의 최신 인계 노트를 읽습니다.

**한 것** (main, 로컬 커밋, push 안 함):
- 다른 곳에서 pull 받은 커밋 3개(489aa13, 473eb0f, 7c07ab4) 점검: typecheck와 테스트 통과, 옛 guild 설정과 호환됨.
- `43ba7b4` fix: 새로 시작하거나 resume한 세션을 첫 메시지 전까지 `idle` 로 둡니다(`src/sessions/sessionManager.ts:165`). 이 수정이 없으면 인박스 전달과 예약 종료가 손대지 않은 세션을 바쁜 것으로 봅니다.
- `538a5d0` feat: 봇의 인박스 감시와 `/a4d inbox on|off|status`.
  - 규칙: `src/sessions/inboxConfig.ts:41` `loadLaneRule`, `:81` `isForLane`. 프로젝트의 `.claude/a4d-inbox.json` 에서 `dir`, `default` include/exclude glob(`{lane}` 치환), `lanes.<세션명>`(덮어쓰기 또는 `match` 별칭)을 읽습니다.
  - 감시: `src/sessions/inboxWatch.ts:77` `startInboxWatch`, `:147` `checkInbox`(3초 폴링), `:228` `setupInboxWatch`. 새 파일은 크기가 더 변하지 않고 세션이 idle일 때 경로와 앞 20줄로 전합니다. 세션 자신이 Write/Edit/Bash로 쓴 파일은 건너뜁니다.
  - 상태 저장: guild 설정의 `inboxWatch: false`(끄기)와 `inboxCursor {dir, since}`(mtime 기준 따라잡기). `src/guild.ts`, `src/sessions/sessionStore.ts` 참고.
  - 연결 지점: 이름이 붙을 때 `src/bot.ts:173`, resume 때 `src/sessions/restore.ts:113`(자동 resume 지시에는 "감시 루프 띄우지 마라"를 붙임, `:178`), `/a4d clear` 때 스위치 유지(`src/commands/clear.ts`), 명령 `src/commands/inbox.ts`.
- `09a7653` fix: 인계 노트 형식 지원. `src/sessions/handoff.ts:70` `handoffRootsFor`(`.planning/handoff/` 가 있으면 기본 root), `:77` `usesHandoffNotes`, `:101` `findLatestHandoff`(폴더와 `.md` 노트 둘 다, NFC 정규화), `:145` `buildHandoffPrompt`, `:186` `buildStartPrompt`(노트 방식은 `~/.claude/modes/handoff.md` 절차를 따름). `src/commands/handoff.ts:51` 은 노트 root에서 폴더 대신 새 노트 경로만 정합니다.
- 중간에 만들었던 "레인마다 고정 파일 `<root>/inbox/<세션명>.md` 에 append" 방식은 실제 규칙(메시지 하나당 파일 하나)과 맞지 않아 soft reset으로 걷어냈습니다. 히스토리에 없습니다.
- README.md, README.ko.md 에 인박스 감시, 인박스 규칙 절, 노트 방식 인계를 추가했습니다.

**남은 것** (우선순위 순):
1. 봇 재시작: `npm run build` 후 `a4d-ctl start`(`node tools/a4d-ctl/a4d-ctl.mjs start`). 사용자 승인 대기 중입니다. 봇은 지금 꺼져 있습니다(10-20 10:39 KST 수동 정지, `~/.agent4discord/ctl.log`).
2. supertonic3-distill 에 `~/ain/supertonic3-distill/.claude/a4d-inbox.json` 을 새 파일로 만들기. 사용자 결정 대기 중입니다. 실제 파일 470개에 시험한 결과 총괄 311, 데이터셋 37, 모델생성 32, 정규화기 37개로, 기존 `eval/watch_inbox*.sh` 와 같은 기준입니다:
   ```json
   {
     "dir": ".planning/inbox",
     "default": { "include": ["*총괄*{lane}*.md", "*총괄*-전레인-*.md"] },
     "lanes": {
       "증류-총괄": { "include": ["*.md"], "exclude": ["*총괄*"] },
       "증류-데이터셋": { "match": "데이터셋" },
       "증류-모델생성": { "match": "모델생성" }
     }
   }
   ```
   설정 파일을 만들 때 그 프로젝트의 감시 루프 지시도 함께 정리해야 이중 감시가 안 생깁니다: `~/ain/supertonic3-distill/CLAUDE.md` 19~22행, `.claude/a4d-on-resume.md` 2번 항목.
3. esp-tts, muon-micro-tts, stt-llm-tts 용 규칙 만들기. 파일명이 `<날짜>-<보낸이>-<받는이>-…` 라서 규칙이 다릅니다(예: 총괄은 include `*-총괄-*.md`, exclude `????-??-??-????-총괄-*`). 각 프로젝트의 `.claude/a4d-on-resume.md` 를 먼저 읽고 정합니다.
4. (선택) reviewer 에이전트로 `7c07ab4..HEAD` 리뷰. 아직 하지 않았습니다.

**막힌 것 / 결정 필요**:
- 위 1번(봇 재시작)과 2번(다른 레포에 파일 쓰기, CLAUDE.md 수정) 모두 사용자 승인이 필요합니다. 추천은 1번을 먼저 하고, 2번은 설정 파일과 CLAUDE.md 감시 지시 정리를 한 번에 하는 것입니다. 지금 돌고 있는 레인이 있으니 총괄에게 공지할지는 사용자가 정합니다.
- push 여부는 미정입니다. 로컬 main이 origin보다 커밋 3개 앞서 있습니다.

**주의**:
- `a4d-ctl restart`/`start` 는 빌드하지 않습니다(`tools/a4d-ctl/lib/settings.mjs:15` 의 `dist/cli.js` 를 그대로 실행). 반드시 `npm run build` 를 먼저 합니다. 지금 `dist/` 는 10-02 빌드입니다.
- 설정 파일 없이 봇을 띄우면 인박스 감시는 어디에서도 켜지지 않습니다. 이것이 의도된 동작이고, 세션은 기존 감시 루프를 그대로 씁니다. 설정 파일을 만든 뒤에는 그 세션에서 `/a4d inbox on` 으로 다시 읽습니다.
- 다른 프로젝트의 `.planning/inbox/`, `.planning/handoff/` 는 다른 세션들이 함께 쓰는 원본입니다. 이 세션에서는 읽기만 했습니다. 시험은 scratchpad의 임시 설정과 `npx tsx` 로만 했습니다.
- 봇 역할에 Create Private Threads 권한이 없으면 🔁 polling 스레드는 턴 스레드로 대신 갑니다(서버 설정에서 따로 줘야 함).
- `npm run lint` 는 `eslint.config.js` 가 원래 없어서 실패합니다. 이번 변경과는 무관합니다.

**검증 방법**:
- `npx tsc --noEmit`, `npx vitest run`: 18개 파일, 테스트 209개 통과가 기대값.
- 재시작 뒤: supertonic3 채널에서 `/a4d inbox status`. 설정 파일이 없으면 "a4d-inbox.json 이 없습니다"가 나오고, 만든 뒤 `/a4d inbox on` 하면 감시 경로가 보입니다. 시험 파일 `.planning/inbox/<날짜>-총괄-답-데이터셋-테스트.md` 를 넣으면 데이터셋 레인 채널에 📥 알림과 `[A4D inbox]` 메시지가 와야 합니다. 시험 파일은 끝나면 `_trash/` 로 옮깁니다.
- 재시작 뒤 새 세션에서 `너는 증류-데이터셋`: 알림에 `인계 노트 …/2026-10-19-2012-증류-데이터셋.md` 가 나와야 합니다.

## 2026-10-20 12:10 — 이어서: 리뷰 반영 커밋 2개, muon-micro-tts 규칙 초안. push·재시작 안 함
- reviewer 로 `7c07ab4..HEAD` 리뷰. 반드시 고칠 것 2건을 고침(테스트 먼저, 211개 통과):
  - `148f34f` fix: system 메시지(init/status/hook/task)마다 idle 로 바뀌던 것(MVP 때부터). 이제 result 만 idle. 인박스 턴 중 전달, 예약 종료 오판 해결.
  - `9744d1a` fix: `/a4d clear` 뒤 이름 붙기 전에 온 인박스 파일이 사라지던 것. 커서가 없으면 세션 시작 시각부터 봄(`src/sessions/inboxWatch.ts` startInboxWatch).
- 남은 리뷰 항목(고치면 좋은 것): 폴링마다 guild JSON 다시 씀(3초), off→on 때 밀린 파일 몰아 전달, mtime 커서라 `cp -p`/`rsync -a` 로 옛 mtime 파일은 재시작 뒤 놓침, 시작 절차보다 인박스가 먼저 갈 수 있음, `match` 값의 `*`/`?` 가 와일드카드로 해석됨.
- 3번 정리: esp-tts 는 10-19 18:40 muon-micro-tts 로 옮겨 끝났고, stt-llm-tts 는 supertonic3-distill 옛 사본(최신 파일 같음). 규칙은 muon-micro-tts 하나만 필요.
  초안(scratchpad 에서 실제 808개로 시험, 셸 기준과 총괄 484·모델 159·분리 60·p4 110·s31 110·앱 21 모두 일치):
  ```json
  {
    "dir": ".planning/inbox",
    "default": { "include": ["*-{lane}-*.md"], "exclude": ["????-??-??-{lane}-*", "????-??-??-????-{lane}-*"] },
    "lanes": { "총괄": { "include": ["*.md"], "exclude": ["????-??-??-총괄-*", "????-??-??-????-총괄-*"] } }
  }
  ```
  세션명이 `총괄`, `모델` … 처럼 보낸이 토큰과 같다는 가정. 다르면 `lanes.<세션명>.match` 로 별칭. 봇 기록에 아직 세션명이 없어 확인 필요.
- 승인 대기는 그대로: 빌드+봇 시작, supertonic3/muon 설정 파일 생성과 감시 루프 지시 정리, push(이제 5커밋 앞섬).

## 2026-10-20 12:10 — 자동 빌드, 세션 명부 1단계. 커밋 2개 더(총 7개 앞섬), push·재시작 안 함
- `0a8023a` feat: `a4d-ctl start/restart` 가 시작 전에 필요하면 `npm ci`(lock 이 install 보다 새로울 때)와 tsc 빌드(src/·tsconfig 가 dist/cli.js 보다 새로울 때)를 함. 봇을 멈춘 뒤에 빌드(봇이 lazy import 함). `--noEmitOnError` 라 빌드 실패 시 이전 dist 로 경고와 함께 시작. `tools/a4d-ctl/lib/build.mjs`, 호출은 `lib/bot.mjs` launchInTmux.
  - 이 PC는 package 파일 mtime(10-02)이 install(10-01)보다 새로워서 첫 시작 때 `npm ci` 가 한 번 돔(내용 변경은 없음).
- `f4ab6c4` feat: 인박스 `README.md` 의 `## 세션` 절을 명부로 읽고, `너는 X` 가 명부에 없거나 이전 이름이면 채널에 경고. `src/sessions/roster.ts`. 전달 규칙은 그대로.
- 총괄 요청 초안: scratchpad `requests/{supertonic3-distill,muon-micro-tts}/2026-10-20-HHMM-a4d-…-세션명부-README교체-요청.md`. 각 프로젝트 규칙으로 총괄에게만 가는 것 확인.
  지금 넣지 않은 이유: 봇이 꺼져 세션이 멈춰 있고, 재시작 뒤 셸 루프는 켤 때 있던 파일을 '본 것'으로 쳐서 미리 넣은 파일을 못 잡음. 재시작 뒤 HHMM 을 실제 시각으로 바꿔 넣을 것.
- 사용자 의도 정정(12:0x): 토큰 공유가 아니라 "기기마다 다른 봇이어도 같은 규칙으로 동작". 기기 로컬에 남은 규칙: `~/.claude/modes/handoff.md`(시작 절차가 참조), config.json 의 claudeModel·permissionMode·maxSessionsPerUser. 제안만 했고 미착수.
- 테스트 222개 통과, tsc 통과.

## 2026-10-20 12:40 — 동작 규칙을 레포 공통 파일로. 커밋 3개 더(총 10개 앞섬), push·재시작 안 함
- `9fd5701` feat: `a4d.defaults.json`(레포 루트) = 모든 기기 공통 동작 설정(opus, default, info, maxSessionsPerUser 100, autoResume true, toolThreadMode turn). 순서: 코드 기본 < 공통 < 기기 config.json. 토큰·clientId·ownerIds 는 공통 파일에서 안 읽음. `--setup` 은 기기 값만 씀. `src/config.ts` REPO_DEFAULTS_PATH.
- `4e6cd12` fix: a4d-ctl 재설치 판단은 package-lock.json 만(package.json 의 files·scripts 변경으로 npm ci 돌던 것).
- `93abd70` feat: 세션 규칙을 `rules/discord.md`, `rules/handoff.md` 로(내용은 ~/.claude/modes/ 의 것, 기기 전용 경로 참조만 바꿈). 붙는 순서: 레포 규칙 → ~/.claude/modes/discord.md(기기 추가) → 프로젝트 .claude/modes/discord.md.
- 사용자 확인 대기:
  - 이 PC의 `~/.claude/modes/discord.md` 가 레포 규칙과 같아서 시스템 프롬프트에 두 번 붙음. 비우거나 기기 전용 규칙만 남길지.
  - 이 PC의 `~/.agent4discord/config.json` 에 claudeModel·permissionMode·logLevel·maxSessionsPerUser 가 있어 공통 값을 덮어씀(값은 지금 같음). 지우면 공통 파일을 고칠 때 이 PC도 따라감.
  - `~/.claude/modes/handoff.md` 는 앱 세션도 쓸 수 있어 그대로 둠.
- 레포가 PUBLIC 이라 push 하면 rules/ 의 작업 규칙이 공개됨(비밀 없음 확인).

## 2026-10-20 12:12 — 이 PC 기기 파일 정리(사용자 승인 1·2)
- `~/.claude/modes/discord.md` → 안내 주석만 남김. 백업 `discord.md.bak-20261020-121143`. 이제 규칙이 한 번만 붙음(시작 절차 1회, 5580→3529자).
- `~/.agent4discord/config.json` 에서 claudeModel·permissionMode·logLevel·maxSessionsPerUser 제거(남은 키: ownerIds, discordToken, discordClientId). 백업 `config.json.bak-20261020-121143`(600). 합쳐 읽은 값은 전과 같음(opus/default/info/100).
- 남은 승인: 봇 시작, 요청 파일 넣기, push(10커밋, PUBLIC).

## 2026-10-20 12:26 — push, 봇 시작, 총괄 명부 요청 넣음 (사용자 지시 "push후 봇시작후 총괄에게 명부 요청")
- push: `7c07ab4..93abd70` main → origin. 이제 origin과 같음.
- 봇 시작: `a4d-ctl start` → ctl.log `prepared: install, build`, `started (manual) pid=26378`. 세션 13개 auto-resume. buildPlan 이제 `{install:false, build:false}`.
- 요청 파일(새 파일):
  - `~/ain/supertonic3-distill/.planning/inbox/2026-10-20-1224-a4d-세션명부-README교체-요청.md` → 총괄 루프(`eval/watch_inbox.sh`)가 12:25:17에 잡음.
  - `~/ain/muon-micro-tts/.planning/inbox/2026-10-20-1225-a4d-총괄-세션명부-README교체-요청.md` → 총괄 루프가 12:25:42에 잡음. p4 루프는 안 잡음(그대로 돎).
- 다음: 두 채널에서 `세션 명부 완료 | …` 회신 확인 → 남은 것 4번(`.claude/a4d-inbox.json` + 감시 루프 지시 정리), 5번(명부 기준 전달).

## 2026-10-20 12:31 — 두 총괄 명부 완료, 봇 코드로 파싱 확인
- supertonic3 README 12:25 갱신: 증류-총괄(이전 총괄), 증류-모델생성(모델생성, 모델학습), 증류-데이터셋(데이터셋), 정규화기, 라즈베리파이. 5개.
- muon README 12:26 갱신: esptts-총괄(총괄), esptts-모델(모델), esptts-분리(분리), esptts-앱(앱), p4, s31, 정렬기. 7개.
- `readRoster`/`rosterWarning` 으로 둘 다 파싱됨, 이전 이름·없는 이름 경고 정상(scratchpad roster-check.ts).
- 주의: muon 세션명이 `esptts-…` 라 12:10 의 muon a4d-inbox.json 초안(세션명=파일명 토큰 가정)은 그대로 못 씀. `lanes.esptts-X.match: "X"` 별칭이 필요하고, 정렬기 레인은 셸 기준 시험에 없었음. 명부 2단계(5번)를 먼저 하면 별칭을 명부에서 가져올 수 있음.

## 2026-10-20 12:55 — 명부 기준 인박스 전달(남은 것 5번). 커밋 1개, push·재시작 안 함
- `d34aace` feat: `.claude/a4d-inbox.json` 에 `"roster": {}` 가 있으면 glob 대신 명부로 판정. 파일명 = 날짜[-HHMM[b]]-보낸이-받는이…-제목, 명부 이름·이전 이름과 낱말 단위로 맞춤(`-` 든 이름은 최장 일치). hub(기본: 이름/이전 이름이 총괄)는 자기가 안 보낸 것 전부, 다른 레인은 받는이에 있거나 `전레인`. `src/sessions/roster.ts` laneNames/readMessageName, `src/sessions/inboxConfig.ts` loadRosterRoute·isForLane, readRoster 를 inboxConfig.ts 로 옮김(순환 import 제거). `/a4d inbox status` 에 명부 기준 표시. README 두 곳. 236개 통과.
- 실제 파일 비교(scratchpad compare.ts, 옛 셸 기준 대비):
  - supertonic3(471): 총괄 312→335(+23 전부 `esptts총괄-…` 다른 프로젝트 총괄이 보낸 것, 옛 루프는 `*총괄*` 제외라 못 받던 것), 데이터셋 37→35(+1 `esptts-데이터셋-…`, -3 `데이터셋답`·`데이터셋D11빌드끝`·`데이터셋참고` 처럼 붙여 쓴 낱말), 모델생성 32→32, 정규화기 37→32(-5 `정규화기6e1dc3e`·`정규화기1차답` 등 붙여 쓴 것, 일부는 다른 레인 앞 메시지에서 언급만), 라즈베리파이 14→15(+1 레인끼리 `정규화기-라즈베리파이-…`).
  - muon(810): 총괄 472→482(+10 `stt-…`, README상 stt=stt-llm-tts 총괄, 옛 루프가 제외했던 것), 모델 159→177·정렬기 7→17(+ `총괄-모델.md` 처럼 받는이가 끝에 오는 것, 옛 `*-X-*` 가 놓침), p4·s31·분리·앱 +1(`총괄-전레인-…`). 잃는 것 0.
  - 붙여 쓴 낱말(supertonic3 8개, 09-28~10-15)은 일부러 안 잡음. 짧은 이름(앱, p4)에 접두 일치를 쓰면 오탐. 두 README 에 파일명 형식이 적혔으니 앞으로는 낱말로 씀.
- 다음: 4번. 두 프로젝트에 `{"dir": ".planning/inbox", "roster": {}}` 만 쓰면 됨 + 감시 루프 지시 정리 + 재시작(또는 각 세션 `/a4d inbox on`). 사용자 확인 필요(다른 레포 수정). 봇은 아직 d34aace 이전 코드로 돎 → 재시작 필요.

## 2026-10-20 13:40 — 두 프로젝트를 봇 인박스 감시(명부 기준)로 전환, 재시작 (사용자 "그렇게 진행해")
- 새 파일 `~/ain/{supertonic3-distill,muon-micro-tts}/.claude/a4d-inbox.json` = `{"dir": ".planning/inbox", "roster": {}}`.
- 지침 수정(다른 레포, 커밋 안 함, 총괄에게 커밋 요청): supertonic3 `CLAUDE.md` 인박스 감시 항목 앞에 "Discord 는 봇, 봇이 알렸으면 루프 안 띄움, 앱 세션·명부 밖만 루프" 한 줄, 두 프로젝트 `.claude/a4d-on-resume.md` 2번에 "재개 메시지 앞에 `[A4D inbox] … 감시` 가 있으면 건너뜀", muon `.claude/CLAUDE.md` 세션 구성에 같은 취지 한 줄. 레인별 루프 지시는 앱 세션·예비용으로 남김.
- 재시작 13:36(pid 24099, `prepared: build`). 감시 9개 시작(커서 13:36), `estts-앱`(muon 앱 레인 세션명 오타)만 명부에 없어 감시 없음 → 그 세션은 예전 `watch_inbox_앱.sh` 를 띄움(의도대로). 다른 레인은 셸 루프 안 띄움(프로세스 확인).
- 공지 파일 `2026-10-20-1336-a4d-봇인박스감시-시작-알림.md`(supertonic3), `2026-10-20-1336-a4d-총괄-봇인박스감시-시작-알림.md`(muon) → 봇이 13:36:46 두 총괄에게만 1회씩 전달(세션 JSONL 확인). 커밋 요청과 estts-앱 이름 정정 안내 포함.
- 남은 것: `d34aace` push 안 함. estts-앱 → `너는 esptts-앱` 로 다시 부르기(사용자; 기존 세션에서 이름 바꾸기가 되는지는 확인 필요). 총괄들의 회신 `봇 인박스 감시 확인 | 커밋 <해시>`. reviewer "고치면 좋은 것"(6번) 그대로.

## 2026-10-20 13:39 — push d34aace, estts-앱 이름 정정은 사용자 확인
- `93abd70..d34aace` main → origin. 로컬과 origin 같음.
- muon 앱 레인 세션명 정정은 사용자가 확인함.
