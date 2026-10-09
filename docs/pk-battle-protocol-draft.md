# PK / Battle 独立协议草稿

本文记录未来独立 PK/battle 协议的讨论范围，不定义 Public 核心 `LiveEvent` 扩展，也不是可供用户写入或回放的稳定 schema。

## 状态

本 Public 仓库目前没有 PK draft schema、manifest、PK fixture 或 PK parser。核心 JSONL replay 仅处理完整的八种 `LiveEvent`；私有 Go ingest 的受支持枚举也仅含相同八种类型。本文不提供 CLI 参数或 parser 命令，也不代表 TikTok-Live-Connector 的字段映射已由真实样本验证。

## 候选语义

PK 数据应以独立 draft envelope 表达，至少区分 `pk_started` 与 `pk_ended`，并为后续验证保留以下语义：

| 语义               | 草稿范围                | 尚待验证的部分                             |
| ------------------ | ----------------------- | ------------------------------------------ |
| Battle identity    | 能关联同一场 PK 的标识  | provider 的字段来源、生命周期内是否稳定    |
| Participants       | 双方参与者的可用身份    | side 顺序、缺失身份和匿名参与者的表达      |
| Stage time         | PK 开始与结束时间       | 时间单位、时区、重连或重复回调语义         |
| Score              | 双方观测到的 score 原值 | 数值精度、累加方式、score 与礼物统计的关系 |
| Provider extension | 未稳定的原始扩展信息    | 允许字段、脱敏范围和兼容策略               |

以上是待验证的语义清单，不承诺固定 JSON 字段名、数值单位或 score 计算方式。缺失或未知值必须明确表示为缺失/未知，不得用 `0` 伪装有效 score；只有输入明确提供的零值才可保留为零。

## 与核心事件的兼容边界

| 类型                                                         | 当前归属          | Public replay                      | Private ingest                   |
| ------------------------------------------------------------ | ----------------- | ---------------------------------- | -------------------------------- |
| `session_started`、`session_ended`                           | 核心 LiveEvent v1 | 接受完整会话中的唯一首尾 lifecycle | 支持                             |
| `comment`、`gift`、`like`、`follow`、`share`、`viewer_count` | 核心 LiveEvent v1 | 按核心 schema 校验                 | 支持                             |
| `pk_started`、`pk_ended`、score/battle                       | 独立协议草稿      | 拒绝，不属于核心 replay 输入       | 不支持，不属于 ingest event enum |

核心枚举与 wire contract 只有在单独评审并同步 Public/Private schema 后才能扩展。PK 草稿不可伪装成核心 `LiveEvent`，也不能作为当前 Gateway/Webhook ingest 的输入。

## 验证状态

Public replay 测试会将 `pk_started` 和 `pk_ended` 当作未知核心事件拒绝。将来交付独立 parser 时，应另行提供版本化 schema、合法/非法 fixture 和离线验证入口；本草稿不声称这些产物已经存在。当前 JSONL/metadata 的文件格式见 [`export-formats.md`](./export-formats.md)。
