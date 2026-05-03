下面是一份比较完整的计划，目标是做一个 **企业内部使用的 AI Agent 工作流 GUI 应用**，形式上类似 **n8n + Codex/CortexCLI + 企业文档产物管理平台**。

---

# 企业内部 AI Agent 工作流平台开发计划

## 1. 项目定位

这个项目不是单纯的 AI 聊天工具，也不是简单的 Codex GUI。

它的核心定位是：

```text
企业内部 AI Agent 工作流编排平台
```

目标是让企业用户可以在一个 GUI 页面中：

```text
创建工作流
配置多个 Agent
运行任务
查看每个 Agent 的执行过程
查看每个 Agent 产出的文档
进行人工审批
归档最终结果
复用已有流程
```

可以理解为：

```text
n8n 的可视化工作流
+
Codex / Claude Code 的 Agent 执行能力
+
企业级文档产物管理
+
审批 / 审计 / 权限控制
```

---

# 2. 核心使用场景

第一版建议先聚焦一个最清晰、最有价值的场景：

```text
企业内部代码审查工作流
```

用户输入一个 PR / MR 链接，系统自动执行多个 Agent：

```text
输入 PR URL
    ↓
需求理解 Agent
    ↓
代码变更分析 Agent
    ↓
安全风险分析 Agent
    ↓
测试建议 Agent
    ↓
文档生成 Agent
    ↓
人工审批
    ↓
生成最终 Review Report
```

每一步都会在 GUI 上显示：

```text
当前执行到哪个 Agent
该 Agent 读取了哪些信息
调用了哪些工具
生成了哪些文档
是否需要人工确认
最终结果是什么
```

---

# 3. 产品目标

## 3.1 第一阶段目标

第一阶段不要做太大，目标是跑通完整闭环。

MVP 目标：

```text
1. 用户可以创建一个固定的代码审查工作流
2. 用户可以输入 PR / MR URL
3. 系统可以按顺序执行多个 Agent
4. 每个 Agent 可以生成一个 Markdown 文档
5. GUI 可以显示工作流节点状态
6. GUI 可以查看每个 Agent 的产物
7. 用户可以进行人工审批
8. 系统可以生成最终报告
```

第一版不需要做：

```text
复杂拖拽编辑器
多团队权限
插件市场
企业级 SSO
多 Agent 并行调度
自动修改代码
自动发 PR comment
复杂沙箱系统
```

先把最小闭环做出来。

---

# 4. 整体架构

推荐架构：

```text
Frontend GUI
    ↓
Backend API
    ↓
Workflow Orchestrator
    ↓
Agent Worker Runtime
    ↓
Model Provider / Tools / Git / 文件系统
```

整体结构：

```text
┌────────────────────────────────────┐
│              Frontend              │
│ React + React Flow                 │
│ 工作流画布 / 运行状态 / 文档查看       │
└─────────────────┬──────────────────┘
                  │ HTTP / WebSocket
┌─────────────────▼──────────────────┐
│              Backend API            │
│ 用户 / 工作流 / 运行记录 / 文档 / 审批 │
└─────────────────┬──────────────────┘
                  │
┌─────────────────▼──────────────────┐
│         Workflow Orchestrator       │
│ DAG 执行 / 节点状态 / 重试 / 审批暂停  │
└─────────────────┬──────────────────┘
                  │
┌─────────────────▼──────────────────┐
│          Agent Worker Runtime       │
│ 执行 Agent / 调用模型 / 工具 / CLI     │
└─────────────────┬──────────────────┘
                  │
┌─────────────────▼──────────────────┐
│       External Systems / Tools      │
│ GitHub / GitLab / Shell / MCP / LLM │
└────────────────────────────────────┘
```

---

# 5. 推荐技术栈

## 5.1 前端

推荐：

```text
React
TypeScript
React Flow
Monaco Editor
Markdown Preview
xterm.js
Tailwind CSS
shadcn/ui
```

用途：

```text
React              主前端框架
React Flow         工作流节点画布
Monaco Editor      查看代码、diff、配置
Markdown Preview   查看 Agent 生成的文档
xterm.js           显示命令执行日志
Tailwind/shadcn     快速做企业级 UI
```

---

## 5.2 后端

有两个推荐路线。

### 方案 A：TypeScript 全栈

适合你想快速开发：

```text
Backend: NestJS / Express
Queue: BullMQ
Database: PostgreSQL
Cache / Queue: Redis
Worker: Node.js child_process / Docker
```

优点：

```text
前后端都用 TypeScript
开发速度快
适合 Electron / Web 技术栈
```

### 方案 B：Python 后端

适合你想更方便接 AI / Agent 工具：

```text
Backend: FastAPI
Queue: Celery / Dramatiq
Database: PostgreSQL
Cache / Queue: Redis
Worker: Python subprocess / Docker
```

优点：

```text
AI 生态更丰富
适合 LangChain / LangGraph / LiteLLM / 自定义 Agent
```

我的建议：

```text
如果你主要做 Web GUI + 企业平台：选 TypeScript
如果你主要做 Agent 后端：选 Python
如果想折中：前端 TypeScript + 后端 FastAPI
```

---

# 6. 项目目录设计

可以这样组织：

```text
agentflow-enterprise/
├─ apps/
│  ├─ web/                  # 前端 GUI
│  ├─ api/                  # 后端 API
│  └─ worker/               # Agent 执行器
│
├─ packages/
│  ├─ shared/               # 共享类型
│  ├─ workflow-core/        # 工作流执行逻辑
│  ├─ agent-core/           # Agent 抽象层
│  ├─ tool-registry/        # 工具注册
│  └─ artifact-core/        # 文档产物管理
│
├─ workflows/
│  └─ code-review.yaml      # 默认工作流模板
│
├─ prompts/
│  ├─ requirement-agent.md
│  ├─ code-review-agent.md
│  ├─ security-agent.md
│  ├─ test-agent.md
│  └─ report-agent.md
│
├─ docker/
│  ├─ postgres/
│  ├─ redis/
│  └─ worker/
│
├─ docs/
│  ├─ architecture.md
│  ├─ workflow-spec.md
│  └─ mvp-roadmap.md
│
└─ README.md
```

---

# 7. 核心模块设计

## 7.1 Workflow Designer

作用：

```text
创建、查看、编辑工作流
```

第一版可以不用完整拖拽编辑，先支持：

```text
从 YAML 加载工作流
在 GUI 中可视化展示
节点状态实时变化
点击节点查看配置
```

后续再做拖拽编辑。

工作流节点类型：

```text
Input Node
Agent Node
Tool Node
Approval Node
Report Node
Output Node
```

---

## 7.2 Agent Registry

作用：

```text
管理不同类型的 Agent
```

每个 Agent 应该有统一配置：

```yaml
id: code_review_agent
name: Code Review Agent
type: agent
model: gpt-5.5
prompt: prompts/code-review-agent.md
tools:
  - read_pr_diff
  - read_file
  - grep
outputs:
  - code_review_report.md
```

未来可以支持：

```text
OpenAI Agent
Claude Agent
Local Ollama Agent
Aider Adapter
Codex CLI Adapter
Custom Python Agent
Shell Agent
```

---

## 7.3 Tool Registry

作用：

```text
管理 Agent 可以调用的工具
```

第一版工具：

```text
read_pr_diff
read_repository_file
list_files
grep_code
run_command
write_artifact
read_artifact
```

后续工具：

```text
GitHub API
GitLab API
Jira API
Confluence API
Slack API
Email API
MCP Tools
Docker Shell
Static Analyzer
Semgrep
ESLint
Pytest
```

工具调用要记录：

```text
哪个 Agent 调用了工具
什么时候调用
输入是什么
输出是什么
是否成功
耗时多久
```

---

## 7.4 Artifact Manager

这是你的项目重点。

每个 Agent 的输出都应该保存为 artifact，而不是只放在聊天记录里。

Artifact 类型：

```text
Markdown 文档
JSON 数据
代码 diff
测试报告
安全报告
最终报告
日志文件
图表
PDF
```

第一版主要支持：

```text
Markdown
JSON
Diff
Plain text
```

每个 artifact 应该有：

```text
artifact_id
workflow_run_id
node_run_id
name
type
content
version
created_by_agent
created_at
status
```

例如：

```text
requirements_summary.md
code_review_report.md
security_report.md
test_plan.md
final_review_report.md
```

---

## 7.5 Human Approval

企业内部必须有人类审批。

审批节点可以暂停工作流：

```text
Agent 执行完成
    ↓
进入 Approval Node
    ↓
等待负责人批准
    ↓
批准后继续执行
```

审批动作：

```text
Approve
Reject
Request Changes
Edit Artifact
Rerun Previous Agent
Skip Node
```

审批记录要保存：

```text
谁审批
什么时候审批
审批意见
审批前后的 artifact 版本
```

---

## 7.6 Audit Log

企业内部应用必须考虑审计。

记录内容：

```text
用户创建了哪个工作流
谁启动了运行
哪个 Agent 执行了什么
读取了哪些文件
调用了哪些工具
生成了哪些 artifact
谁进行了审批
是否有失败或重试
```

审计日志结构：

```text
timestamp
user_id
workflow_id
workflow_run_id
node_id
event_type
event_payload
```

事件类型：

```text
WORKFLOW_CREATED
WORKFLOW_STARTED
NODE_STARTED
TOOL_CALLED
ARTIFACT_CREATED
APPROVAL_REQUESTED
APPROVAL_GRANTED
NODE_FAILED
WORKFLOW_COMPLETED
```

---

# 8. 工作流数据结构设计

第一版可以用 YAML 定义工作流。

示例：

```yaml
name: Code Review Workflow
description: Multi-agent internal code review workflow
version: 1

inputs:
  pr_url:
    type: string
    required: true
    label: Pull Request URL

nodes:
  - id: input
    type: input
    name: PR Input

  - id: requirement_agent
    type: agent
    name: Requirement Analyst
    depends_on:
      - input
    model: gpt-5.5
    prompt: prompts/requirement-agent.md
    tools:
      - read_pr_description
      - read_pr_diff
    outputs:
      - requirements_summary.md

  - id: code_review_agent
    type: agent
    name: Code Reviewer
    depends_on:
      - requirement_agent
    model: gpt-5.5
    prompt: prompts/code-review-agent.md
    tools:
      - read_pr_diff
      - read_file
      - grep_code
    outputs:
      - code_review_report.md

  - id: security_agent
    type: agent
    name: Security Reviewer
    depends_on:
      - code_review_agent
    model: gpt-5.5
    prompt: prompts/security-agent.md
    tools:
      - read_pr_diff
      - grep_code
      - run_semgrep
    outputs:
      - security_report.md

  - id: test_agent
    type: agent
    name: Test Planner
    depends_on:
      - security_agent
    model: gpt-5.5
    prompt: prompts/test-agent.md
    tools:
      - read_pr_diff
      - read_file
    outputs:
      - test_plan.md

  - id: human_approval
    type: approval
    name: Human Approval
    depends_on:
      - test_agent
    required_role: reviewer

  - id: final_report_agent
    type: agent
    name: Final Report Writer
    depends_on:
      - human_approval
    model: gpt-5.5
    prompt: prompts/final-report-agent.md
    tools:
      - read_artifact
      - write_artifact
    outputs:
      - final_review_report.md
```

---

# 9. 数据库设计

第一版核心表：

```text
users
workflows
workflow_versions
workflow_runs
nodes
node_runs
agents
artifacts
tool_calls
approvals
audit_logs
credentials
```

## 9.1 workflows

```sql
id
name
description
created_by
created_at
updated_at
```

## 9.2 workflow_versions

```sql
id
workflow_id
version
definition_yaml
created_at
```

## 9.3 workflow_runs

```sql
id
workflow_id
workflow_version_id
status
input_payload
started_by
started_at
finished_at
```

状态：

```text
pending
running
waiting_approval
completed
failed
cancelled
```

## 9.4 node_runs

```sql
id
workflow_run_id
node_id
node_name
node_type
status
started_at
finished_at
error_message
```

状态：

```text
pending
running
succeeded
failed
skipped
waiting_approval
```

## 9.5 artifacts

```sql
id
workflow_run_id
node_run_id
name
type
version
content_path
created_by
created_at
```

## 9.6 tool_calls

```sql
id
workflow_run_id
node_run_id
tool_name
input_json
output_json
status
started_at
finished_at
```

## 9.7 approvals

```sql
id
workflow_run_id
node_run_id
requested_by
approved_by
status
comment
created_at
resolved_at
```

---

# 10. 前端页面设计

## 10.1 首页 Dashboard

显示：

```text
最近运行的工作流
成功 / 失败 / 等待审批数量
常用 workflow templates
新建运行按钮
```

---

## 10.2 Workflow Library

显示所有工作流模板：

```text
Code Review Workflow
Release Note Workflow
Security Audit Workflow
Bug Triage Workflow
Document Generation Workflow
```

每个 workflow 可以：

```text
查看
运行
复制
编辑
删除
查看历史版本
```

---

## 10.3 Workflow Canvas 页面

主界面布局：

```text
┌─────────────────────────────────────────────┐
│ 顶部：Workflow 名称 / Run 状态 / Start 按钮   │
├──────────────┬──────────────────────────────┤
│ 左侧节点库     │ 中间 React Flow Canvas        │
│ Agent Nodes   │                              │
│ Tool Nodes    │                              │
│ Approval      │                              │
├──────────────┴──────────────┬───────────────┤
│ 底部 Logs / Timeline         │ 右侧配置面板   │
└──────────────────────────────┴───────────────┘
```

节点颜色：

```text
灰色：Pending
蓝色：Running
绿色：Succeeded
红色：Failed
黄色：Waiting Approval
紫色：Human Step
```

---

## 10.4 Run Detail 页面

显示某一次运行的完整记录：

```text
Workflow Run ID
Input
运行时间
当前状态
节点执行路径
每个节点产物
日志
成本
工具调用
审批记录
```

---

## 10.5 Artifact 页面

点击某个 Agent 节点后，右侧显示：

```text
该 Agent 生成的所有文档
文档版本
Markdown 预览
原始文本
下载按钮
复制按钮
```

例如：

```text
Requirement Analyst Agent
├─ requirements_summary.md
├─ business_context.md
└─ risk_assumptions.md
```

---

# 11. Agent 执行流程

每个 Agent 节点执行逻辑：

```text
1. 读取 workflow context
2. 读取前置节点的 artifacts
3. 加载自己的 prompt
4. 组装模型输入
5. 调用 LLM
6. 如果需要工具，调用 Tool Registry
7. 生成 artifact
8. 保存 artifact
9. 更新 node_run 状态
10. 推送 WebSocket 事件给 GUI
```

伪代码：

```ts
async function runAgentNode(node, context) {
  updateNodeStatus(node.id, "running");

  const prompt = await loadPrompt(node.prompt);
  const previousArtifacts = await loadPreviousArtifacts(node.depends_on);
  const tools = loadTools(node.tools);

  const result = await agentExecutor.run({
    prompt,
    context,
    previousArtifacts,
    tools,
    model: node.model,
  });

  for (const artifact of result.artifacts) {
    await artifactManager.save(artifact);
  }

  await saveToolCalls(result.toolCalls);
  updateNodeStatus(node.id, "succeeded");

  return result;
}
```

---

# 12. Agent 输出格式

为了稳定解析，Agent 不应该随便输出文本。

建议要求每个 Agent 输出结构化 JSON：

```json
{
  "summary": "本次代码变更主要涉及支付模块。",
  "artifacts": [
    {
      "name": "code_review_report.md",
      "type": "markdown",
      "content": "# Code Review Report\n\n..."
    }
  ],
  "risks": [
    {
      "level": "medium",
      "title": "缺少异常退款测试",
      "description": "payment/refund.ts 新增逻辑没有对应测试。"
    }
  ],
  "next_actions": [
    "补充 refund failure case 测试",
    "确认异常状态码处理逻辑"
  ]
}
```

这样 GUI 更容易显示。

---

# 13. 权限和安全设计

企业内部不能让 Agent 随便执行命令。

第一版权限分级：

```text
Level 0: 只读文本输入
Level 1: 读取 PR / repo diff
Level 2: 读取仓库文件
Level 3: 执行安全的只读命令
Level 4: 写入 artifact
Level 5: 修改代码文件
Level 6: 提交 comment / PR / email
```

MVP 建议只做到 Level 4：

```text
可以读取 PR
可以读取代码
可以生成文档
不直接修改代码
不直接提交 PR comment
```

这样安全很多。

---

# 14. MVP 开发计划

## Phase 0：项目初始化

目标：搭好项目骨架。

任务：

```text
1. 创建 monorepo
2. 初始化前端 React
3. 初始化后端 API
4. 初始化 PostgreSQL
5. 初始化 Redis
6. Docker Compose 启动环境
7. 定义 shared types
```

产物：

```text
可以启动 web + api + db
```

---

## Phase 1：Workflow 可视化

目标：把 YAML workflow 显示成节点图。

任务：

```text
1. 设计 workflow YAML schema
2. 后端读取 workflow YAML
3. 前端调用 API 获取 workflow
4. React Flow 渲染节点和连线
5. 点击节点显示配置
```

产物：

```text
用户可以看到 Code Review Workflow 的可视化图
```

---

## Phase 2：Workflow Run 执行框架

目标：让工作流能按顺序跑起来。

任务：

```text
1. 创建 workflow_run 表
2. 创建 node_run 表
3. 实现 DAG 排序
4. 实现节点状态更新
5. 实现 WebSocket 推送状态
6. 前端实时显示节点状态
```

产物：

```text
点击 Run 后，节点可以从 Pending → Running → Succeeded
```

此阶段可以先用 mock agent。

---

## Phase 3：Artifact 系统

目标：每个节点可以生成文档。

任务：

```text
1. 创建 artifacts 表
2. 实现 artifact 保存
3. 实现 artifact 查询 API
4. 前端显示 artifact 列表
5. 前端支持 Markdown 预览
6. 支持 artifact 版本
```

产物：

```text
每个 Agent 节点执行后可以生成 Markdown 文档
```

---

## Phase 4：接入真实 LLM Agent

目标：让 Agent 真的生成分析文档。

任务：

```text
1. 接入 OpenAI / Anthropic / Ollama provider
2. 设计 AgentExecutor
3. 加载 prompt 文件
4. 将 PR diff 和上下文传给模型
5. 解析模型输出
6. 保存为 artifact
```

产物：

```text
Requirement Agent / Code Review Agent / Security Agent 可以生成真实报告
```

---

## Phase 5：接入 GitHub / GitLab PR

目标：输入 PR URL 后读取真实 diff。

任务：

```text
1. 解析 GitHub / GitLab PR URL
2. 配置 access token
3. 调用 API 获取 PR title / description / diff
4. 存入 workflow context
5. 给后续 Agent 使用
```

产物：

```text
用户输入 PR URL 后，系统可以读取 PR 信息并生成报告
```

---

## Phase 6：Human Approval

目标：工作流可以暂停等待人工审批。

任务：

```text
1. 添加 approval node
2. 后端执行到 approval node 时暂停
3. 前端显示审批面板
4. 用户 Approve / Reject
5. 审批后继续或终止工作流
6. 记录审批日志
```

产物：

```text
工作流可以在 Human Approval 节点暂停并等待用户操作
```

---

## Phase 7：最终报告生成

目标：合并所有 Agent 的文档，生成最终报告。

任务：

```text
1. Final Report Agent 读取前面所有 artifacts
2. 生成 final_review_report.md
3. 前端展示最终结果
4. 支持下载 Markdown
5. 可选导出 PDF
```

产物：

```text
完整代码审查报告
```

---

# 15. 第一版最终效果

用户流程：

```text
1. 打开平台
2. 选择 Code Review Workflow
3. 输入 PR URL
4. 点击 Run
5. 看到节点一个个运行
6. 点击每个 Agent 查看产物
7. 在 Human Approval 节点审批
8. 最终生成 Review Report
```

GUI 效果：

```text
[PR Input]
    ↓
[Requirement Agent] ✅ requirements_summary.md
    ↓
[Code Review Agent] ✅ code_review_report.md
    ↓
[Security Agent] ✅ security_report.md
    ↓
[Test Agent] ✅ test_plan.md
    ↓
[Human Approval] ⏸ waiting
    ↓
[Final Report Agent] ✅ final_review_report.md
```

---

# 16. 后续高级功能

MVP 完成后可以加：

```text
1. 拖拽式 workflow 编辑器
2. Agent 模板市场
3. Prompt 版本管理
4. Artifact 对比
5. 自动发布 PR comment
6. Jira / Confluence 集成
7. Slack 通知
8. 企业 SSO
9. RBAC 权限控制
10. Docker 沙箱执行命令
11. MCP 工具接入
12. 多模型 provider
13. 运行成本统计
14. Workflow 运行历史对比
15. Agent 失败重试策略
```

---

# 17. 不建议第一版做的内容

这些先不要做：

```text
1. 完整 n8n 级别的 workflow editor
2. 多租户企业权限
3. 自动修改代码并提交
4. 长期记忆系统
5. 自定义插件市场
6. 多 Agent 并行复杂调度
7. 远程分布式 worker
8. 复杂沙箱权限系统
9. 自训练模型
10. 企业级计费系统
```

这些会让项目过早复杂化。

---

# 18. 推荐开发顺序

最合理的顺序是：

```text
1. 先做 Workflow Canvas
2. 再做 Mock Run
3. 再做 Artifact Viewer
4. 再接入 LLM
5. 再接入 GitHub / GitLab
6. 再做审批
7. 最后做最终报告
```

不要一开始就接 LLM。
先把平台结构跑起来，再把 Agent 换成真实模型。

---

# 19. 项目最小 Demo 范围

如果你想快速做一个能展示的 Demo，范围可以压缩成：

```text
输入一个本地 fake PR diff
    ↓
运行 3 个 mock Agent
    ↓
生成 3 个 Markdown artifact
    ↓
GUI 节点图显示状态
    ↓
点击节点查看文档
    ↓
点击 Approve
    ↓
生成 final_report.md
```

这个 Demo 已经可以体现你的核心创新点：

```text
可视化 Agent 工作流
每个 Agent 的产物可追踪
人类审批
最终报告生成
```

---

# 20. 最终建议

你的项目不要叫“Codex GUI”。

更准确的方向是：

```text
Enterprise Agent Workflow Studio
```

核心卖点：

```text
1. 可视化 Agent 工作流
2. 每一步都有文档产物
3. 可审计、可审批、可复用
4. 支持 CLI Agent / LLM Agent / Tool Agent
5. 适合企业内部流程自动化
```

第一版目标非常明确：

```text
做一个企业内部代码审查 Agent 工作流平台
```

最小闭环：

```text
PR URL
→ 多 Agent 分析
→ 多文档产出
→ GUI 可视化
→ 人工审批
→ 最终报告
```

这比单纯做一个 Codex 桌面版更有辨识度，也更适合作为企业内部工具或毕业/作品集项目。
