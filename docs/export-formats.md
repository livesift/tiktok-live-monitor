# Public 导出格式

本文定义 Public CLI 的核心 `LiveEvent` JSONL 和 session metadata 归档格式。`LiveEvent` 沿用 [JSON Schema](../schemas/live-event.schema.json) 中的 v1 契约；metadata 使用独立的 [JSON Schema](../schemas/session-metadata.schema.json)，不会作为事件写入 JSONL、stdout 或 Webhook。

## JSONL

JSONL 文件使用 UTF-8 编码，每行是一个完整的 JSON object，记录末尾有一个换行符。行顺序就是 sink 成功接收并写入的事件顺序；文件不包含数组包装、空白分隔行、CLI 状态文本或 session 摘要。v1 核心类型为 `session_started`、`session_ended`、`comment`、`gift`、`like`、`follow`、`share` 和 `viewer_count`。事件字段、可选 actor/raw、各类型 data 和 UTC 时间字段详见上述 schema 与 [九行示例](../examples/session.jsonl)。

每场会话共享 `session.id`、Creator 引用和可用的 `session.roomId`。第一行是唯一的 `session_started`，最后一行是唯一的 `session_ended`；后者给出开始/结束时间和结束原因。当前 JSONL 不包含 metadata 行。

既有 `--output <path>` 仍将相对路径按当前工作目录解析，连接前递归创建父目录并以 truncate 模式打开目标；目标文件存在时会被覆盖，也不会自动生成 metadata。

## CSV 草稿

`examples/session.csv` 是与核心 JSONL fixture 对应的 `csv-draft-v1` 交换格式草稿，不代表 CLI 已支持 CSV 导出。列顺序固定为以下 15 列，第一行为表头，每个事件占一条 CSV 记录：

```text
id,platform,type,occurredAt,receivedAt,sessionId,roomId,creatorUsername,creatorUserId,creatorNickname,actorUserId,actorUsername,actorNickname,dataJson,rawJson
```

身份字段从 `session`、`creator` 和 `actor` 对象展开；`dataJson` 是完整 `data` object 的紧凑 JSON 字符串，`rawJson` 在事件含有 `raw` 时保存完整 JSON，否则为空。CSV 中没有独立 metadata 行，事件顺序与 JSONL 相同。

文件使用 UTF-8、无 BOM，记录分隔符为 CRLF。单元格缺少可选标量时写为空字段，不写 `null`；显式数字 `0` 写成 `0`，不能当成缺失值。`dataJson` 和 `rawJson` 内的 JSON 类型和值不做转换。此草稿不承诺区分缺失标量与空字符串。

遵循 RFC 4180 引用规则：单元格含逗号、双引号、CR 或 LF 时，整个单元格用双引号括起，内部双引号写成两个双引号。引用单元格中的 CRLF 属于该字段内容，不是新记录。特殊文本示例见 [`session-csv-escaping.csv`](../examples/session-csv-escaping.csv)；使用以下测试解析该示例和九条核心 fixture，并对照固定列及 `dataJson`：

```bash
npm test -- --run test/csv-draft.test.ts
```

该 CSV 只作为格式草稿和测试样例；没有 CSV exporter，也没有 `--csv` CLI 参数。

显式使用 `--output-dir <directory>` 时，CLI 为每个会话创建新目录：

```text
<directory>/<creator-key>/<UTC-YYYY-MM-DD>/<UTC-HHmmssSSS>_<session-key>/
  events.jsonl
  session.metadata.json
```

路径键由 `c-` 或 `s-` 前缀加原始 UTF-8 身份的十六进制字节组成，保存在 metadata 中的身份仍是原值。日期和时间取 `session_started.data.startedAt` 的 UTC 值，与机器时区无关。目录以排他模式创建；重复会话目录会报错，不追加、不覆盖。`--output` 和 `--output-dir` 互斥；不指定二者时不写本地文件。

## Session Metadata

每个目录归档有一份独立 `session.metadata.json`。字段和严格类型以 `schemas/session-metadata.schema.json` 为准；`schemas/fixtures/valid-session-metadata.json` 展示完整归档，`schemas/fixtures/recording-session-metadata.json` 展示尚未结束的快照。

- `metadataSchemaVersion` 是 metadata 格式版本 `1`；`eventSchemaId` 指向 LiveEvent v1；`packageVersion` 记录生成归档的 package 版本。
- `source` 为 `live` 或 `replay`，`platform` 为 `tiktok`；`session` 与 `creator` 保留完整身份对象。
- `startedAt` 取开始事件；收到并成功写入结束事件后，`endedAt` 和 `endReason` 取结束事件。没有已写入的结束事件时，两项为 `null`。
- `status` 可为 `recording`、`completed`、`interrupted` 或 `failed`。正在写入的快照状态是 `recording`；成功结束并关闭 events 文件后才更新最终状态。信号导致的已结束会话为 `interrupted`；写入、关闭或运行失败为 `failed`。
- `eventCount` 和 `eventCounts` 统计成功写入 JSONL 的总事件数及八种类型数量，包含首尾 lifecycle。运行期间 metadata 不逐事件刷新，`recording` 快照中的计数不是实时进度；以最终状态的计数为准。
- `eventsFile` 是相对 session 目录的固定路径 `events.jsonl`。

终态 metadata 先写入同目录临时文件，再原子替换正式文件。若进程被强制终止或文件系统阻止最后更新，metadata 可能仍为 `recording`；消费者应将其视作未完成归档。events 与 metadata 是两个文件，不提供跨文件事务或断电恢复保证。

## 离线回放

正式 CLI 可对一场完整的核心 `LiveEvent` JSONL 会话执行即时回放。回放保留事件对象和文件顺序，不重新 normalization、不补造 lifecycle，也不创建 TikTok provider；Gateway 环境变量会被忽略，不会发送 Webhook 或其他 HTTP 请求。

```bash
npm run dev -- --replay examples/session.jsonl --json
npm run dev -- --replay examples/session.jsonl --json --output ./data/replay.jsonl
npm run dev -- --replay examples/session.jsonl --json --output-dir ./data/replays
```

输入必须是 UTF-8 JSONL，最多 16 MiB；可有一个正常的末尾换行，但不能有空白数据行。每行必须通过核心 LiveEvent runtime schema；全文件只能包含一场会话，首行是唯一 `session_started`，末行是唯一 `session_ended`，所有事件共享完整 session/Creator 身份，结束事件的 `startedAt` 必须与开始事件一致。CLI 会先读取和验证完整输入，再初始化输出；输入无效时会报告文件路径和行号或具体会话约束，stdout 为空，旧 `--output` 文件不会被截断。

`--replay` 不需要 username，且不能与 username、`--webhook` 或 `--webhook-header` 同用。它支持 `--json`、`--output` 和 `--output-dir`；JSON 模式的 stdout 只包含原始事件行，回放摘要与诊断写入 stderr。该模式即时运行，不是下方约 18 秒的终端 Demo，也不验证真实 provider 连通性。

## PK / battle 草稿

PK/battle 是独立协议草稿，不属于核心 `LiveEvent`。核心 schema 和 replay 只接受 `session_started`、`session_ended`、`comment`、`gift`、`like`、`follow`、`share`、`viewer_count` 八种类型；`pk_started`、`pk_ended` 和 score/battle 数据不能写成核心事件。Public CLI replay 会拒绝未知 PK 类型，Private ingest 也不接受 PK 类型。当前仓库没有已交付的 PK schema、fixture 或 parser；不要把这份草稿当成可执行命令或已验证 provider 映射。

独立草稿的字段范围和兼容边界见 [`PK/battle 协议草稿`](./pk-battle-protocol-draft.md)。未知 score 不得以 `0` 充当占位值。

## 本地验证

使用确定性 fixture 导出一份目录归档：

```bash
npm run dev -- @username --output-dir ./data
npm run dev -- --json @username --output-dir ./data > session.stdout.jsonl
npm run dev -- --replay examples/session.jsonl --json --output-dir ./data/replays
```

第一条命令保留人类可读终端输出；第二条让 stdout 只包含 JSONL 事件，状态和摘要写入 stderr。两条 LIVE 命令需要有效 LIVE 连接，第三条从仓库 fixture 离线回放，不需要账号或网络。也可在项目内使用以下测试验证归档 metadata、JSONL schema 和文件行为：

```bash
npm test -- --run test/session-export.test.ts test/session-metadata.test.ts test/session-fixture.test.ts test/replay.test.ts test/replay-cli.test.ts
```

归档根目录在连接前检查可创建性和可写性；错误会在 provider 连接前返回。容器挂载目录还必须对镜像运行用户可写。
