export type WorkflowNodeType =
  | "input"
  | "agent"
  | "approval"
  | "output"
  | "report"
  | "trigger"
  | "model_selector"
  | "tool_executor"
  | "document_loader"
  | "retriever"
  | "condition"
  | "merge"
  | "filter";

export type WorkflowRunStatus =
  | "pending"
  | "running"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "cancelled";

export type NodeRunStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "skipped"
  | "waiting_approval";

export type OutputFormat = "markdown" | "html" | "pdf" | "json" | "text";

export type ArtifactType = OutputFormat | "diff";

export type ApprovalStatus = "pending" | "approved" | "rejected";

export type AgentProviderKind =
  | "mock"
  | "openai_responses"
  | "anthropic"
  | "ollama"
  | "openai_compatible"
  | "codex_cli";

export type RunEventType =
  | "workflow_started"
  | "node_started"
  | "node_succeeded"
  | "node_failed"
  | "node_skipped"
  | "artifact_created"
  | "approval_requested"
  | "approval_resolved"
  | "workflow_completed"
  | "workflow_failed";

export type RiskLevel = "low" | "medium" | "high";

export interface WorkflowInputDefinition {
  type: "string" | "text" | "files";
  required: boolean;
  label: string;
}

export interface WorkflowNodePosition {
  x: number;
  y: number;
}

export type WorkflowConnectionMode = "inputs" | "outputs";
export type WorkflowConnectionType = "main";
export type StandardWorkflowConnectionHandle = `${WorkflowConnectionMode}/${WorkflowConnectionType}/${number}`;
export type LegacyWorkflowConnectionHandle = "main" | "true" | "false";
export type WorkflowConnectionHandle = LegacyWorkflowConnectionHandle | StandardWorkflowConnectionHandle;

export interface ParsedWorkflowConnectionHandle {
  mode: WorkflowConnectionMode;
  type: WorkflowConnectionType;
  index: number;
  handle: StandardWorkflowConnectionHandle;
  legacy: boolean;
  valid: boolean;
}

export interface WorkflowConnectionPort {
  handle: StandardWorkflowConnectionHandle;
  mode: WorkflowConnectionMode;
  type: WorkflowConnectionType;
  index: number;
  label: string;
  required?: boolean;
  maxConnections?: number;
}

export interface WorkflowNodePorts {
  inputs: WorkflowConnectionPort[];
  outputs: WorkflowConnectionPort[];
}

export interface WorkflowConnection {
  id: string;
  source: string;
  target: string;
  sourceHandle?: WorkflowConnectionHandle;
  targetHandle?: WorkflowConnectionHandle;
}

export function createConnectionHandle(
  mode: WorkflowConnectionMode,
  type: WorkflowConnectionType = "main",
  index = 0
): StandardWorkflowConnectionHandle {
  return `${mode}/${type}/${index}` as StandardWorkflowConnectionHandle;
}

export function parseConnectionHandle(
  handle: string | null | undefined,
  fallbackMode: WorkflowConnectionMode = "outputs"
): ParsedWorkflowConnectionHandle {
  if (!handle || handle === "main") {
    return {
      mode: fallbackMode,
      type: "main",
      index: 0,
      handle: createConnectionHandle(fallbackMode, "main", 0),
      legacy: Boolean(handle),
      valid: true
    };
  }

  if (handle === "true" || handle === "false") {
    const index = handle === "true" ? 0 : 1;
    return {
      mode: "outputs",
      type: "main",
      index,
      handle: createConnectionHandle("outputs", "main", index),
      legacy: true,
      valid: true
    };
  }

  const parts = handle.split("/");
  const mode = parts[0] === "inputs" || parts[0] === "outputs" ? parts[0] : fallbackMode;
  const type = parts[1] === "main" ? "main" : "main";
  const index = Number(parts[2]);
  const valid = parts.length === 3 && (parts[0] === "inputs" || parts[0] === "outputs") && parts[1] === "main" && Number.isInteger(index) && index >= 0;
  const resolvedIndex = valid ? index : 0;

  return {
    mode,
    type,
    index: resolvedIndex,
    handle: createConnectionHandle(mode, type, resolvedIndex),
    legacy: false,
    valid
  };
}

export function normalizeConnectionHandle(
  handle: string | null | undefined,
  fallbackMode: WorkflowConnectionMode
): StandardWorkflowConnectionHandle {
  return parseConnectionHandle(handle, fallbackMode).handle;
}

export function createConnectionId(
  source: string,
  sourceHandle: string | null | undefined,
  target: string,
  targetHandle: string | null | undefined
): string {
  const normalizedSource = normalizeConnectionHandle(sourceHandle, "outputs");
  const normalizedTarget = normalizeConnectionHandle(targetHandle, "inputs");
  return `[${source}/${normalizedSource}][${target}/${normalizedTarget}]`;
}

export function normalizeWorkflowConnection(connection: WorkflowConnection): WorkflowConnection {
  const sourceHandle = normalizeConnectionHandle(connection.sourceHandle, "outputs");
  const targetHandle = normalizeConnectionHandle(connection.targetHandle, "inputs");
  return {
    ...connection,
    id: connection.id || createConnectionId(connection.source, sourceHandle, connection.target, targetHandle),
    sourceHandle,
    targetHandle
  };
}

export function normalizeWorkflowConnections(connections: WorkflowConnection[] = []): WorkflowConnection[] {
  return connections.map(normalizeWorkflowConnection);
}

function port(mode: WorkflowConnectionMode, index: number, label: string, options: Omit<WorkflowConnectionPort, "handle" | "mode" | "type" | "index" | "label"> = {}): WorkflowConnectionPort {
  return {
    handle: createConnectionHandle(mode, "main", index),
    mode,
    type: "main",
    index,
    label,
    ...options
  };
}

export function getNodePorts(node: Pick<WorkflowNode, "type">): WorkflowNodePorts {
  const mainInput = port("inputs", 0, "Input");
  const mainOutput = port("outputs", 0, "Output");

  switch (node.type) {
    case "input":
      return { inputs: [], outputs: [mainOutput] };
    case "trigger":
      return { inputs: [], outputs: [port("outputs", 0, "Start")] };
    case "condition":
      return {
        inputs: [mainInput],
        outputs: [port("outputs", 0, "True"), port("outputs", 1, "False")]
      };
    case "output":
      return { inputs: [mainInput], outputs: [] };
    case "report":
      return { inputs: [mainInput], outputs: [mainOutput] };
    default:
      return { inputs: [mainInput], outputs: [mainOutput] };
  }
}

export type TriggerMode = "manual";

export type ModelProvider = "mock" | "codex_cli" | "openai_responses" | "ollama" | "openai_compatible";

export type ToolKind = "d_rd_cli_status" | "git_status" | "list_input_files";

export type DocumentSource = "input_files" | "upstream_artifacts" | "both";

export type ConditionSource = "context_note" | "optional_diff" | "combined_artifacts";
export type ConditionOperator = "contains" | "not_contains" | "equals" | "exists";

export type MergeStrategy = "concat_artifacts";

export type FilterOperator = "contains" | "not_contains";

export interface TriggerNodeConfig {
  mode: TriggerMode;
}

export interface ModelSelectorNodeConfig {
  provider: ModelProvider;
  model: string;
}

export interface ToolExecutorNodeConfig {
  toolKind: ToolKind;
}

export interface DocumentLoaderNodeConfig {
  source: DocumentSource;
}

export interface RetrieverNodeConfig {
  query?: string;
  topK?: number;
}

export interface ConditionNodeConfig {
  source: ConditionSource;
  operator: ConditionOperator;
  value?: string;
}

export interface MergeNodeConfig {
  strategy: MergeStrategy;
}

export interface FilterNodeConfig {
  operator: FilterOperator;
  value: string;
}

export interface WorkflowNodeInputConfig {
  acceptsFiles?: boolean;
  acceptsText?: boolean;
  label?: string;
}

export interface WorkflowNodeOutputConfig {
  formats: OutputFormat[];
  artifactName?: string;
}

export interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  name: string;
  description?: string;
  depends_on?: string[];
  position?: WorkflowNodePosition;
  agentId?: string;
  skillIds?: string[];
  inputConfig?: WorkflowNodeInputConfig;
  outputConfig?: WorkflowNodeOutputConfig;
  model?: string;
  prompt?: string;
  tools?: string[];
  outputs?: string[];
  required_role?: string;
  triggerConfig?: TriggerNodeConfig;
  modelSelectorConfig?: ModelSelectorNodeConfig;
  toolExecutorConfig?: ToolExecutorNodeConfig;
  documentLoaderConfig?: DocumentLoaderNodeConfig;
  retrieverConfig?: RetrieverNodeConfig;
  conditionConfig?: ConditionNodeConfig;
  mergeConfig?: MergeNodeConfig;
  filterConfig?: FilterNodeConfig;
}

export type WorkflowStatus = "active" | "draft" | "archived";

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  version: number;
  status?: WorkflowStatus;
  template?: boolean;
  createdAt?: string;
  updatedAt?: string;
  inputs: Record<string, WorkflowInputDefinition>;
  nodes: WorkflowNode[];
  connections?: WorkflowConnection[];
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  workflowVersion: number;
  status: WorkflowRunStatus;
  inputPayload: RunInputPayload;
  startedBy: string;
  startedAt: string;
  finishedAt?: string;
  errorMessage?: string;
}

export interface NodeRun {
  id: string;
  workflowRunId: string;
  nodeId: string;
  nodeName: string;
  nodeType: WorkflowNodeType;
  status: NodeRunStatus;
  startedAt?: string;
  finishedAt?: string;
  errorMessage?: string;
}

export interface Artifact {
  id: string;
  workflowRunId: string;
  nodeRunId: string;
  nodeId: string;
  name: string;
  type: ArtifactType;
  version: number;
  contentPath: string;
  createdBy: string;
  createdAt: string;
}

export interface ArtifactWithContent extends Artifact {
  content: string;
}

export interface Approval {
  id: string;
  workflowRunId: string;
  nodeRunId: string;
  status: ApprovalStatus;
  requestedBy: string;
  approvedBy?: string;
  comment?: string;
  createdAt: string;
  resolvedAt?: string;
}

export interface RunEvent {
  id: string;
  workflowRunId: string;
  nodeId?: string;
  type: RunEventType;
  message: string;
  payload?: Record<string, unknown>;
  createdAt: string;
}

export interface Risk {
  level: RiskLevel;
  title: string;
  description: string;
}

export interface AgentArtifactOutput {
  name: string;
  type: OutputFormat;
  content: string;
}

export interface AgentResult {
  summary: string;
  artifacts: AgentArtifactOutput[];
  risks: Risk[];
  nextActions: string[];
}

export interface LocalInputFile {
  id: string;
  name: string;
  relativePath?: string;
  size: number;
  type?: string;
  content: string;
}

export interface RunInputPayload {
  sourceLabel: string;
  contextNote?: string;
  files: LocalInputFile[];
  prUrl?: string;
  prDiff?: string;
}

export interface CreateRunRequest {
  workflowId: string;
  inputPayload: RunInputPayload;
}

export interface ApprovalRequest {
  action: "approve" | "reject";
  comment?: string;
}

export interface RunState {
  run: WorkflowRun;
  workflow: WorkflowDefinition;
  nodeRuns: NodeRun[];
  artifacts: Artifact[];
  approvals: Approval[];
  events: RunEvent[];
}

export interface WorkflowSummary {
  id: string;
  name: string;
  description: string;
  version: number;
  nodeCount: number;
  status?: WorkflowStatus;
  template?: boolean;
  updatedAt?: string;
}

export interface AgentDefinition {
  id: string;
  name: string;
  description: string;
  provider: AgentProviderKind;
  model: string;
  systemPrompt: string;
  outputFormats: OutputFormat[];
  skillIds: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  content: string;
  sourcePath?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StudioOverview {
  workflows: WorkflowSummary[];
  agents: AgentDefinition[];
  skills: SkillDefinition[];
  recentRuns: WorkflowRun[];
}

export interface CreateWorkflowRequest {
  template?: "blank" | "code-review";
  name?: string;
  description?: string;
}

export interface UpdateWorkflowRequest {
  workflow: WorkflowDefinition;
}

export interface CreateAgentRequest {
  name: string;
  description?: string;
  provider?: AgentProviderKind;
  model?: string;
  systemPrompt?: string;
  outputFormats?: OutputFormat[];
  skillIds?: string[];
  enabled?: boolean;
}

export interface UpdateAgentRequest extends CreateAgentRequest {
  id?: string;
}

export interface CreateSkillRequest {
  name: string;
  description?: string;
  content?: string;
  sourcePath?: string;
  enabled?: boolean;
}

export interface UpdateSkillRequest extends CreateSkillRequest {
  id?: string;
}

export type CliChatStatus = "idle" | "running" | "completed" | "cancelled" | "error";

export type CliProviderStatus = "not_ready" | "ready" | "running" | "error";

export type CliChatRole = "user" | "assistant" | "system" | "error";

export type CliStreamEventType =
  | "status"
  | "message_created"
  | "chunk"
  | "completed"
  | "cancelled"
  | "error";

export interface CliContextFile {
  name: string;
  relativePath?: string;
  size: number;
}

export interface CliChatContext {
  workflowId?: string;
  workflowName?: string;
  runId?: string;
  runStatus?: WorkflowRunStatus;
  selectedNodeId?: string;
  selectedNodeName?: string;
  contextNote?: string;
  localFiles?: CliContextFile[];
}

export interface CliChatSession {
  id: string;
  status: CliChatStatus;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
}

export interface CliChatMessage {
  id: string;
  sessionId: string;
  role: CliChatRole;
  content: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface CliProviderStatusResponse {
  status: CliProviderStatus;
  cliCorePath: string;
  entrypoint?: string;
  command?: string;
  bunAvailable: boolean;
  dependenciesInstalled: boolean;
  message: string;
}

export interface CreateCliSessionRequest {
  context?: CliChatContext;
}

export interface SendCliMessageRequest {
  content: string;
  context?: CliChatContext;
}

export interface CliStreamEvent {
  id: string;
  sessionId: string;
  type: CliStreamEventType;
  messageId?: string;
  content?: string;
  message?: CliChatMessage;
  status?: CliChatStatus | CliProviderStatus;
  error?: string;
  payload?: Record<string, unknown>;
  createdAt: string;
}

export const DEFAULT_USER_ID = "local-reviewer";
