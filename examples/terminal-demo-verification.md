# Terminal Demo 验收记录

- Package：`tiktok-live-monitor 0.1.0-alpha.1`
- 验收日期：2026-10-07
- 环境：Node.js `v26.10.0`、npm `11.19.1`
- 输入：`examples/session.jsonl` 中的 9 条合成 `LiveEvent`，单一 session ID；不连接 TikTok、Webhook 网络服务、LiveSift 或 Private Gateway。

## 离线行式回放

执行 `npm run demo:terminal`，命令耗时约 18.34 秒。renderer stdout 与 [`terminal-demo.txt`](./terminal-demo.txt) 一致，stderr 无错误输出；[capture](./terminal-demo.cast) 的时间戳从 `0` 到 `18.0` 秒。输出包含 LIVE、viewer `1,842`、peak `1,842`、comment、gift、like、follow、share 和最终摘要。

最终 stdout 摘要：

```text
SESSION SUMMARY
Session ID: session-fixture-1
Status: completed
Comments: 1
Gifts: 1
Likes: 1
Follows: 1
Shares: 1
Viewer samples: 2
Current viewers: 1,842
Peak viewers: 1842
```

## CLI Sink 验收

执行 `npm test -- --run test/terminal-acceptance.test.ts`，3 项 fixture-based CLI 验收通过。测试用 fixture provider 驱动真实 `runCli`，不访问外部网络。

| 模式                 | stdout                                        | stderr                        | 文件 / Webhook mock                                                        |
| -------------------- | --------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------- |
| 默认行式             | lifecycle、事件和一份 completed 摘要；无 ANSI | 空                            | 不创建 JSONL 文件                                                          |
| `--json --output`    | 9 行可解析 JSONL，不含 renderer 文本          | 连接状态和一份 completed 摘要 | stdout 与文件逐字节相同，均等于 fixture 的规范化 JSONL                     |
| `--output --webhook` | 人类可读事件和一份 completed 摘要             | 空                            | 文件为 9 行原始 JSONL；Webhook mock 收到与 fixture 完全相同的 9 个事件对象 |

`--json` 模式的 stderr 摘要字段为 `Comments: 1`、`Gifts: 1`、`Likes: 1`、`Follows: 1`、`Shares: 1`、`Viewer samples: 2`、`Current viewers: 1,842` 和 `Peak viewers: 1842`。所有模式都只连接和断开 provider 一次。
