# Public 导出与回放验收记录

- Package：`tiktok-live-monitor 0.1.0`
- 验收日期：2026-10-09
- 宿主环境：Node.js `v26.10.0`、npm `11.19.1`、UID/GID `501:20`
- Docker 环境：Docker Engine `29.4.0`（client/server）、OrbStack、Linux/arm64；production image 使用 `node:20-bookworm-slim`
- 输入：`examples/session.jsonl` 中的 9 条合成核心 `LiveEvent`，单一 session ID；不连接 TikTok、Webhook、LiveSift 或 Private Gateway。
- 发布状态：只在本地 build/run；没有发布 npm package、GHCR image 或 GitHub artifact。

## 命令与退出码

以下命令均从 Public 仓库根目录运行。归档写入新建临时目录；Docker mount 使用宿主 UID/GID：

| 验收                | 命令                                                                                                                                                                                                                                                             | 退出码 |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -----: |
| 构建 package        | `npm run build`                                                                                                                                                                                                                                                  |      0 |
| 构建产物离线 replay | `node dist/cli/index.js --replay examples/session.jsonl --json`                                                                                                                                                                                                  |      0 |
| 构建产物目录归档    | `node dist/cli/index.js --replay examples/session.jsonl --json --output-dir "$TEMP_ROOT/package-archive"`                                                                                                                                                        |      0 |
| 构建 Docker image   | `docker build --tag livesift-public-task5:10820 .`                                                                                                                                                                                                               |      0 |
| Docker 禁网 replay  | `docker run --rm --network none --env LIVESIFT_GATEWAY_URL=http://127.0.0.1:1 livesift-public-task5:10820 --replay /app/examples/session.jsonl --json`                                                                                                           |      0 |
| Docker 禁网挂载归档 | `docker run --rm --network none --user "$(id -u):$(id -g)" --mount "type=bind,src=$TEMP_ROOT/docker-archive,dst=/data" --env LIVESIFT_GATEWAY_URL=http://127.0.0.1:1 livesift-public-task5:10820 --replay /app/examples/session.jsonl --json --output-dir /data` |      0 |

`$TEMP_ROOT` 是本次运行新建的临时目录，验收后已清理。Docker image tag 也已在验收后删除。

## 对照结果

- Package replay stdout、package 归档 stdout、Docker replay stdout、Docker 归档 stdout 和两份归档 `events.jsonl` 均解析为 9 个事件，顺序及对象内容与 `examples/session.jsonl` 深度相等。
- JSON object 的键顺序不是比较依据；对照按 JSONL 行顺序解析后比较事件对象。metadata 与 events 分开读取，没有混入 stdout JSONL。
- 两份 `session.metadata.json` 均通过 `schemas/session-metadata.schema.json`，且 `source=replay`、`status=completed`、`packageVersion=0.1.0`、`eventCount=9`；Creator、session、开始/结束时间及八类 `eventCounts` 均与 fixture 相符，计数总和为 9。
- Docker replay 在 `--network none` 下运行，并设置不可达的 `LIVESIFT_GATEWAY_URL`；命令成功，未依赖 Gateway 网络。
