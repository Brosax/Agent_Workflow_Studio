import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  type OnEdgesChange,
  type OnNodesChange
} from "@xyflow/react";
import {
  AlertTriangle,
  Bot,
  Check,
  ChevronDown,
  Circle,
  Clock,
  Copy,
  Download,
  FilePlus2,
  FileText,
  Home,
  LoaderCircle,
  MessageSquare,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Save,
  Send,
  Sparkles,
  Square,
  Terminal,
  Trash2,
  Workflow,
  X
} from "lucide-react";
import type {
  AgentDefinition,
  ApprovalRequest,
  Artifact,
  ArtifactWithContent,
  CliChatContext,
  CliChatMessage,
  CliChatSession,
  CliProviderStatusResponse,
  CliStreamEvent,
  CreateAgentRequest,
  CreateSkillRequest,
  LocalInputFile,
  NodeRun,
  NodeRunStatus,
  OutputFormat,
  RunEvent,
  RunState,
  SendCliMessageRequest,
  SkillDefinition,
  StudioOverview,
  UpdateWorkflowRequest,
  WorkflowDefinition,
  WorkflowNode as WorkflowNodeDefinition,
  WorkflowNodeType,
  WorkflowSummary
} from "@agent-studio/shared";

const DEFAULT_CONTEXT_NOTE = "Run this workflow against the selected local files.";
const MAX_FILE_BYTES = 220_000;
const nodeTypes = { workflow: WorkflowNodeCard };

type Page = "home" | "builder" | "agents" | "skills";

type WorkflowNodeData = {
  label: string;
  nodeType: WorkflowNodeType;
  status: NodeRunStatus;
  artifactCount: number;
  description?: string;
};

export function App() {
  const [page, setPage] = useState<Page>("home");
  const [overview, setOverview] = useState<StudioOverview>();
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [agents, setAgents] = useState<AgentDefinition[]>([]);
  const [skills, setSkills] = useState<SkillDefinition[]>([]);
  const [workflow, setWorkflow] = useState<WorkflowDefinition>();
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const [runState, setRunState] = useState<RunState>();
  const [selectedArtifactId, setSelectedArtifactId] = useState<string>();
  const [selectedArtifact, setSelectedArtifact] = useState<ArtifactWithContent>();
  const [localFiles, setLocalFiles] = useState<LocalInputFile[]>([]);
  const [contextNote, setContextNote] = useState(DEFAULT_CONTEXT_NOTE);
  const [optionalDiff, setOptionalDiff] = useState("");
  const [approvalComment, setApprovalComment] = useState("Reviewed and approved.");
  const [viewMode, setViewMode] = useState<"preview" | "raw">("preview");
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState<Node<WorkflowNodeData>>([]);
  const [flowEdges, setFlowEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const [chatOpen, setChatOpen] = useState(false);
  const [cliStatus, setCliStatus] = useState<CliProviderStatusResponse>();
  const [chatSession, setChatSession] = useState<CliChatSession>();
  const [chatMessages, setChatMessages] = useState<CliChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [includeChatContext, setIncludeChatContext] = useState(true);
  const [chatError, setChatError] = useState<string>();

  const selectedNode = workflow?.nodes.find((node) => node.id === selectedNodeId);
  const nodeRunsByNodeId = useMemo(
    () => new Map((runState?.nodeRuns ?? []).map((nodeRun) => [nodeRun.nodeId, nodeRun])),
    [runState?.nodeRuns]
  );
  const artifactsByNodeId = useMemo(() => groupArtifactsByNode(runState?.artifacts ?? []), [runState?.artifacts]);
  const selectedNodeArtifacts = selectedNode ? artifactsByNodeId.get(selectedNode.id) ?? [] : [];

  const refreshOverview = useCallback(async () => {
    const response = await fetch("/api/studio/overview");
    if (!response.ok) {
      throw new Error(`Failed to load Studio overview: ${response.status}`);
    }
    const data = (await response.json()) as StudioOverview;
    setOverview(data);
    setWorkflows(data.workflows);
    setAgents(data.agents);
    setSkills(data.skills);
    return data;
  }, []);

  const refreshWorkflow = useCallback(async (workflowId: string) => {
    const response = await fetch(`/api/workflows/${workflowId}`);
    if (!response.ok) {
      throw new Error(`Failed to load workflow: ${response.status}`);
    }
    const data = (await response.json()) as WorkflowDefinition;
    setWorkflow(data);
    setSelectedNodeId(data.nodes[0]?.id);
    setRunState(undefined);
    setSelectedArtifactId(undefined);
    setSelectedArtifact(undefined);
    return data;
  }, []);

  const refreshRun = useCallback(async (runId: string) => {
    const response = await fetch(`/api/runs/${runId}`);
    if (!response.ok) {
      throw new Error(`Failed to refresh run: ${response.status}`);
    }
    const state = (await response.json()) as RunState;
    setRunState(state);
    return state;
  }, []);

  const refreshCliStatus = useCallback(async () => {
    const response = await fetch("/api/cli/status");
    if (!response.ok) {
      throw new Error(`Failed to read CLI status: ${response.status}`);
    }
    const status = (await response.json()) as CliProviderStatusResponse;
    setCliStatus(status);
    return status;
  }, []);

  const refreshCliMessages = useCallback(async (sessionId: string) => {
    const response = await fetch(`/api/cli/sessions/${sessionId}/messages`);
    if (!response.ok) {
      throw new Error(`Failed to read CLI messages: ${response.status}`);
    }
    setChatMessages((await response.json()) as CliChatMessage[]);
  }, []);

  const upsertChatMessage = useCallback((message: CliChatMessage) => {
    setChatMessages((currentMessages) => upsertCliMessage(currentMessages, message));
  }, []);

  useEffect(() => {
    void refreshOverview()
      .then((data) => {
        const firstWorkflow = data.workflows[0];
        if (firstWorkflow) {
          return refreshWorkflow(firstWorkflow.id);
        }
        return undefined;
      })
      .catch((caught: unknown) => setError(readError(caught)));
  }, [refreshOverview, refreshWorkflow]);

  useEffect(() => {
    void refreshCliStatus().catch((caught: unknown) => setChatError(readError(caught)));
    const intervalId = window.setInterval(() => {
      void refreshCliStatus().catch(() => undefined);
    }, 30_000);
    return () => window.clearInterval(intervalId);
  }, [refreshCliStatus]);

  useEffect(() => {
    if (!runState?.run.id) {
      return;
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${window.location.host}/ws/runs/${runState.run.id}`);
    socket.onmessage = () => {
      void refreshRun(runState.run.id).catch((caught: unknown) => setError(readError(caught)));
    };
    return () => socket.close();
  }, [refreshRun, runState?.run.id]);

  useEffect(() => {
    if (!chatSession?.id) {
      return;
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${window.location.host}/ws/cli/sessions/${chatSession.id}`);
    socket.onmessage = (messageEvent) => {
      const event = JSON.parse(String(messageEvent.data)) as CliStreamEvent;
      if (event.type === "message_created" && event.message) {
        upsertChatMessage(event.message);
      }
      if (event.type === "chunk" && event.messageId && event.content) {
        setChatMessages((currentMessages) =>
          currentMessages.map((message) =>
            message.id === event.messageId ? { ...message, content: `${message.content}${event.content}` } : message
          )
        );
      }
      const nextStatus = event.status;
      if (event.type === "status" && isCliChatStatus(nextStatus)) {
        setChatSession((currentSession) =>
          currentSession
            ? { ...currentSession, status: nextStatus, lastError: event.error ?? currentSession.lastError }
            : currentSession
        );
      }
      if (event.type === "completed" || event.type === "cancelled" || event.type === "error") {
        if (event.error) {
          setChatError(event.error);
        }
        void refreshCliMessages(chatSession.id).catch((caught: unknown) => setChatError(readError(caught)));
        void refreshCliStatus().catch(() => undefined);
      }
    };
    return () => socket.close();
  }, [chatSession?.id, refreshCliMessages, refreshCliStatus, upsertChatMessage]);

  useEffect(() => {
    if (!selectedArtifactId) {
      setSelectedArtifact(undefined);
      return;
    }

    void fetch(`/api/artifacts/${selectedArtifactId}`)
      .then((response) => response.json())
      .then((artifact: ArtifactWithContent) => setSelectedArtifact(artifact))
      .catch((caught: unknown) => setError(readError(caught)));
  }, [selectedArtifactId]);

  useEffect(() => {
    if (!workflow) {
      setFlowNodes([]);
      setFlowEdges([]);
      return;
    }

    setFlowNodes(
      workflow.nodes.map((node, index) => ({
        id: node.id,
        type: "workflow",
        position: node.position ?? { x: 160 + index * 300, y: 160 },
        data: {
          label: node.name,
          nodeType: node.type,
          status: nodeRunsByNodeId.get(node.id)?.status ?? "pending",
          artifactCount: artifactsByNodeId.get(node.id)?.length ?? 0,
          description: node.description
        }
      }))
    );

    setFlowEdges(
      workflow.nodes.flatMap((node) =>
        (node.depends_on ?? []).map((dependency) => ({
          id: `${dependency}-${node.id}`,
          source: dependency,
          target: node.id,
          animated: nodeRunsByNodeId.get(node.id)?.status === "running",
          style: { stroke: "#6b7280", strokeWidth: 1.5 }
        }))
      )
    );
  }, [artifactsByNodeId, nodeRunsByNodeId, setFlowEdges, setFlowNodes, workflow]);

  async function createWorkflow(template: "blank" | "code-review" = "blank") {
    setIsBusy(true);
    setError(undefined);
    try {
      const response = await fetch("/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template })
      });
      if (!response.ok) {
        throw new Error((await response.json()).error ?? "Failed to create workflow.");
      }
      const next = (await response.json()) as WorkflowDefinition;
      await refreshOverview();
      await refreshWorkflow(next.id);
      setPage("builder");
    } catch (caught) {
      setError(readError(caught));
    } finally {
      setIsBusy(false);
    }
  }

  async function saveWorkflow(): Promise<boolean> {
    if (!workflow) {
      return false;
    }

    setIsBusy(true);
    setError(undefined);
    try {
      const workflowToSave = materializeWorkflowFromCanvas(workflow, flowNodes, flowEdges);
      const response = await fetch(`/api/workflows/${workflow.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflow: workflowToSave } satisfies UpdateWorkflowRequest)
      });
      if (!response.ok) {
        throw new Error((await response.json()).error ?? "Failed to save workflow.");
      }
      const saved = (await response.json()) as WorkflowDefinition;
      setWorkflow(saved);
      await refreshOverview();
      return true;
    } catch (caught) {
      setError(readError(caught));
      return false;
    } finally {
      setIsBusy(false);
    }
  }

  async function duplicateWorkflow(workflowId: string) {
    const response = await fetch(`/api/workflows/${workflowId}/duplicate`, { method: "POST" });
    if (!response.ok) {
      setError((await response.json()).error ?? "Failed to duplicate workflow.");
      return;
    }
    const next = (await response.json()) as WorkflowDefinition;
    await refreshOverview();
    await refreshWorkflow(next.id);
    setPage("builder");
  }

  function updateWorkflowField<K extends keyof WorkflowDefinition>(field: K, value: WorkflowDefinition[K]) {
    setWorkflow((current) => (current ? { ...current, [field]: value } : current));
  }

  function updateSelectedNode(patch: Partial<WorkflowNodeDefinition>) {
    if (!selectedNodeId) {
      return;
    }
    setWorkflow((current) =>
      current
        ? {
            ...current,
            nodes: current.nodes.map((node) => (node.id === selectedNodeId ? { ...node, ...patch } : node))
          }
        : current
    );
  }

  function addWorkflowNode(type: WorkflowNodeType) {
    if (!workflow) {
      return;
    }
    const id = uniqueNodeId(type, workflow.nodes);
    const previousNode = selectedNode ?? workflow.nodes[workflow.nodes.length - 1];
    const node = createNode(type, id, previousNode?.id);
    setWorkflow({ ...workflow, nodes: [...workflow.nodes, node] });
    setSelectedNodeId(id);
  }

  function deleteSelectedNode() {
    if (!workflow || !selectedNode || selectedNode.type === "input") {
      return;
    }
    const nodes = workflow.nodes
      .filter((node) => node.id !== selectedNode.id)
      .map((node) => ({
        ...node,
        depends_on: (node.depends_on ?? []).filter((dependency) => dependency !== selectedNode.id)
      }));
    setWorkflow({ ...workflow, nodes });
    setSelectedNodeId(nodes[0]?.id);
  }

  const onConnect = useCallback(
    (connection: Connection) => setFlowEdges((edges) => addEdge(connection, edges)),
    [setFlowEdges]
  );

  function autoLayoutNodes() {
    if (!workflow) {
      return;
    }
    const positions = getAutoLayoutPositions(workflow.nodes);
    setFlowNodes((currentNodes) =>
      currentNodes.map((node) => ({
        ...node,
        position: positions.get(node.id) ?? node.position
      }))
    );
  }

  async function addLocalFiles(fileList: FileList | null) {
    if (!fileList?.length) {
      return;
    }
    const nextFiles = await Promise.all(
      Array.from(fileList).map(async (file) => {
        const content = await file.slice(0, MAX_FILE_BYTES).text();
        const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || undefined;
        return {
          id: crypto.randomUUID(),
          name: file.name,
          relativePath,
          size: file.size,
          type: file.type || "text/plain",
          content:
            file.size > MAX_FILE_BYTES
              ? `${content}\n\n[File truncated to ${formatBytes(MAX_FILE_BYTES)} for the local demo.]`
              : content
        } satisfies LocalInputFile;
      })
    );
    setLocalFiles((currentFiles) => [...currentFiles, ...nextFiles]);
  }

  async function startRun() {
    if (!workflow) {
      return;
    }
    const saved = await saveWorkflow();
    if (!saved) {
      return;
    }
    setIsBusy(true);
    setError(undefined);
    setSelectedArtifactId(undefined);
    setSelectedArtifact(undefined);
    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workflowId: workflow.id,
          inputPayload: {
            sourceLabel: localFiles.length
              ? `${localFiles.length} local file${localFiles.length === 1 ? "" : "s"}`
              : "Manual text input",
            contextNote,
            files: localFiles,
            prDiff: optionalDiff
          }
        })
      });
      if (!response.ok) {
        throw new Error((await response.json()).error ?? "Failed to start workflow.");
      }
      const state = (await response.json()) as RunState;
      setRunState(state);
      setSelectedNodeId(state.workflow.nodes[0]?.id);
      await refreshOverview();
    } catch (caught) {
      setError(readError(caught));
    } finally {
      setIsBusy(false);
    }
  }

  async function resolveApproval(action: ApprovalRequest["action"]) {
    if (!runState) {
      return;
    }
    try {
      const response = await fetch(`/api/runs/${runState.run.id}/approval`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, comment: approvalComment } satisfies ApprovalRequest)
      });
      if (!response.ok) {
        throw new Error((await response.json()).error ?? "Approval update failed.");
      }
      setRunState((await response.json()) as RunState);
    } catch (caught) {
      setError(readError(caught));
    }
  }

  function openArtifact(artifact: Artifact) {
    setSelectedArtifactId(artifact.id);
    setViewMode("preview");
  }

  async function copyArtifact() {
    if (selectedArtifact) {
      await navigator.clipboard.writeText(selectedArtifact.content);
    }
  }

  function downloadArtifact() {
    if (!selectedArtifact) {
      return;
    }
    const mime = artifactMime(selectedArtifact.type);
    const blob = new Blob([selectedArtifact.content], { type: mime });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = selectedArtifact.name;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function createAgent() {
    const request: CreateAgentRequest = {
      name: `Agent ${agents.length + 1}`,
      description: "Custom workflow agent",
      provider: "mock",
      model: "mock-agent",
      systemPrompt: "Analyze the input and generate an artifact.",
      outputFormats: ["markdown"],
      enabled: true
    };
    await mutateJson("/api/agents", "POST", request);
    await refreshOverview();
  }

  async function saveAgent(agent: AgentDefinition) {
    await mutateJson(`/api/agents/${agent.id}`, "PUT", agent);
    await refreshOverview();
  }

  async function deleteAgent(agentId: string) {
    await fetch(`/api/agents/${agentId}`, { method: "DELETE" });
    await refreshOverview();
  }

  async function createSkill() {
    const request: CreateSkillRequest = {
      name: `Skill ${skills.length + 1}`,
      description: "Studio managed skill",
      content: "# Skill\n\nDescribe how this skill should guide an agent.",
      enabled: true
    };
    await mutateJson("/api/skills", "POST", request);
    await refreshOverview();
  }

  async function saveSkill(skill: SkillDefinition) {
    await mutateJson(`/api/skills/${skill.id}`, "PUT", skill);
    await refreshOverview();
  }

  async function scanSkills() {
    setIsBusy(true);
    try {
      await fetch("/api/skills/scan", { method: "POST" });
      await refreshOverview();
    } finally {
      setIsBusy(false);
    }
  }

  async function deleteSkill(skillId: string) {
    await fetch(`/api/skills/${skillId}`, { method: "DELETE" });
    await refreshOverview();
  }

  function buildCurrentCliContext(): CliChatContext {
    return {
      workflowId: workflow?.id,
      workflowName: workflow?.name,
      runId: runState?.run.id,
      runStatus: runState?.run.status,
      selectedNodeId,
      selectedNodeName: selectedNode?.name,
      contextNote,
      localFiles: localFiles.map((file) => ({
        name: file.name,
        relativePath: file.relativePath,
        size: file.size
      }))
    };
  }

  async function ensureChatSession(): Promise<CliChatSession> {
    if (chatSession) {
      return chatSession;
    }
    const response = await fetch("/api/cli/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context: buildCurrentCliContext() })
    });
    if (!response.ok) {
      throw new Error((await response.json()).error ?? "Failed to create CLI chat session.");
    }
    const session = (await response.json()) as CliChatSession;
    setChatSession(session);
    setChatMessages([]);
    return session;
  }

  async function openChat() {
    setChatOpen(true);
    setChatError(undefined);
    try {
      await refreshCliStatus();
      await ensureChatSession();
    } catch (caught) {
      setChatError(readError(caught));
    }
  }

  async function sendChatMessage() {
    const content = chatInput.trim();
    if (!content || chatSession?.status === "running") {
      return;
    }
    setChatError(undefined);
    try {
      const status = await refreshCliStatus();
      if (status.status !== "ready") {
        throw new Error(status.message);
      }
      const session = await ensureChatSession();
      setChatInput("");
      const response = await fetch(`/api/cli/sessions/${session.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          context: includeChatContext ? buildCurrentCliContext() : undefined
        } satisfies SendCliMessageRequest)
      });
      if (!response.ok) {
        throw new Error((await response.json()).error ?? "CLI chat request failed.");
      }
      const body = (await response.json()) as {
        session: CliChatSession;
        userMessage: CliChatMessage;
        assistantMessage: CliChatMessage;
      };
      setChatSession(body.session);
      upsertChatMessage(body.userMessage);
      upsertChatMessage(body.assistantMessage);
    } catch (caught) {
      setChatError(readError(caught));
      setChatInput(content);
    }
  }

  async function stopChatRequest() {
    if (!chatSession || chatSession.status !== "running") {
      return;
    }
    const response = await fetch(`/api/cli/sessions/${chatSession.id}/stop`, { method: "POST" });
    if (response.ok) {
      setChatSession((await response.json()) as CliChatSession);
    }
  }

  return (
    <main className="studio-app">
      <aside className="studio-sidebar">
        <div className="studio-brand">
          <div className="brand-mark">EA</div>
          <div>
            <h1>Agent Workflow Studio</h1>
            <p>Local workflow lab</p>
          </div>
        </div>
        <nav className="studio-nav">
          <button className={page === "home" ? "active" : ""} onClick={() => setPage("home")}>
            <Home size={17} />
            Home
          </button>
          <button className={page === "builder" ? "active" : ""} onClick={() => setPage("builder")}>
            <Workflow size={17} />
            Builder
          </button>
          <button className={page === "agents" ? "active" : ""} onClick={() => setPage("agents")}>
            <Bot size={17} />
            Agents
          </button>
          <button className={page === "skills" ? "active" : ""} onClick={() => setPage("skills")}>
            <Sparkles size={17} />
            Skills
          </button>
        </nav>
        <button className="new-workflow-button" disabled={isBusy} onClick={() => void createWorkflow("blank")}>
          <Plus size={18} />
          New workflow
        </button>
        {error ? <div className="error-box">{error}</div> : null}
      </aside>

      {page === "home" ? (
        <HomePage
          overview={overview}
          workflows={workflows}
          onCreate={() => void createWorkflow("blank")}
          onOpen={(workflowId) => {
            void refreshWorkflow(workflowId);
            setPage("builder");
          }}
          onDuplicate={(workflowId) => void duplicateWorkflow(workflowId)}
        />
      ) : null}

      {page === "builder" ? (
        <BuilderPage
          workflow={workflow}
          agents={agents}
          skills={skills}
          runState={runState}
          selectedNode={selectedNode}
          selectedNodeArtifacts={selectedNodeArtifacts}
          selectedArtifact={selectedArtifact}
          selectedArtifactId={selectedArtifactId}
          viewMode={viewMode}
          localFiles={localFiles}
          contextNote={contextNote}
          optionalDiff={optionalDiff}
          approvalComment={approvalComment}
          flowNodes={flowNodes}
          flowEdges={flowEdges}
          nodeRunsByNodeId={nodeRunsByNodeId}
          isBusy={isBusy}
          onWorkflowField={updateWorkflowField}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onSelectNode={setSelectedNodeId}
          onAddNode={addWorkflowNode}
          onDeleteNode={deleteSelectedNode}
          onUpdateNode={updateSelectedNode}
          onSave={() => void saveWorkflow()}
          onAutoLayout={autoLayoutNodes}
          onStartRun={() => void startRun()}
          onRefreshRun={() => runState && void refreshRun(runState.run.id)}
          onAddFiles={(files) => void addLocalFiles(files)}
          onRemoveFile={(fileId) => setLocalFiles((current) => current.filter((file) => file.id !== fileId))}
          onContextNote={setContextNote}
          onOptionalDiff={setOptionalDiff}
          onArtifact={openArtifact}
          onViewMode={setViewMode}
          onCopyArtifact={() => void copyArtifact()}
          onDownloadArtifact={downloadArtifact}
          onApprovalComment={setApprovalComment}
          onResolveApproval={(action) => void resolveApproval(action)}
        />
      ) : null}

      {page === "agents" ? (
        <AgentPage
          agents={agents}
          skills={skills}
          onCreate={() => void createAgent()}
          onSave={(agent) => void saveAgent(agent)}
          onDelete={(agentId) => void deleteAgent(agentId)}
        />
      ) : null}

      {page === "skills" ? (
        <SkillPage
          skills={skills}
          isBusy={isBusy}
          onCreate={() => void createSkill()}
          onScan={() => void scanSkills()}
          onSave={(skill) => void saveSkill(skill)}
          onDelete={(skillId) => void deleteSkill(skillId)}
        />
      ) : null}

      <CliChatDock
        open={chatOpen}
        cliStatus={cliStatus}
        session={chatSession}
        messages={chatMessages}
        input={chatInput}
        includeContext={includeChatContext}
        error={chatError}
        onOpen={() => void openChat()}
        onClose={() => setChatOpen(false)}
        onInputChange={setChatInput}
        onIncludeContextChange={setIncludeChatContext}
        onSend={() => void sendChatMessage()}
        onStop={() => void stopChatRequest()}
      />
    </main>
  );
}

function HomePage(props: {
  overview?: StudioOverview;
  workflows: WorkflowSummary[];
  onCreate: () => void;
  onOpen: (workflowId: string) => void;
  onDuplicate: (workflowId: string) => void;
}) {
  return (
    <section className="studio-page home-page">
      <header className="page-header">
        <div>
          <span className="eyebrow">Studio Home</span>
          <h2>Build reusable agent workflows</h2>
          <p>Create workflow canvases, manage agents and skills, then run them against local files.</p>
        </div>
        <button className="primary-button compact" onClick={props.onCreate}>
          <Plus size={17} />
          New
        </button>
      </header>

      <div className="metric-grid">
        <Metric title="Workflows" value={props.overview?.workflows.length ?? 0} />
        <Metric title="Agents" value={props.overview?.agents.length ?? 0} />
        <Metric title="Skills" value={props.overview?.skills.length ?? 0} />
        <Metric title="Recent runs" value={props.overview?.recentRuns.length ?? 0} />
      </div>

      <section className="resource-section">
        <div className="section-title-row">
          <h3>Workflows</h3>
          <button className="ghost-button" onClick={props.onCreate}>
            <FilePlus2 size={16} />
            Blank workflow
          </button>
        </div>
        <div className="workflow-card-grid">
          {props.workflows.map((workflow) => (
            <article key={workflow.id} className="workflow-card">
              <div>
                <span className="eyebrow">{workflow.template ? "template" : workflow.status ?? "active"}</span>
                <h3>{workflow.name}</h3>
                <p>{workflow.description}</p>
              </div>
              <div className="card-footer">
                <span>{workflow.nodeCount} nodes</span>
                <div className="button-row tight">
                  <button className="ghost-button" onClick={() => props.onDuplicate(workflow.id)}>
                    <Copy size={15} />
                    Copy
                  </button>
                  <button className="primary-button compact" onClick={() => props.onOpen(workflow.id)}>
                    <Workflow size={15} />
                    Open
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}

function BuilderPage(props: {
  workflow?: WorkflowDefinition;
  agents: AgentDefinition[];
  skills: SkillDefinition[];
  runState?: RunState;
  selectedNode?: WorkflowNodeDefinition;
  selectedNodeArtifacts: Artifact[];
  selectedArtifact?: ArtifactWithContent;
  selectedArtifactId?: string;
  viewMode: "preview" | "raw";
  localFiles: LocalInputFile[];
  contextNote: string;
  optionalDiff: string;
  approvalComment: string;
  flowNodes: Node<WorkflowNodeData>[];
  flowEdges: Edge[];
  nodeRunsByNodeId: Map<string, NodeRun>;
  isBusy: boolean;
  onWorkflowField: <K extends keyof WorkflowDefinition>(field: K, value: WorkflowDefinition[K]) => void;
  onNodesChange: OnNodesChange<Node<WorkflowNodeData>>;
  onEdgesChange: OnEdgesChange<Edge>;
  onConnect: (connection: Connection) => void;
  onSelectNode: (nodeId: string) => void;
  onAddNode: (type: WorkflowNodeType) => void;
  onDeleteNode: () => void;
  onUpdateNode: (patch: Partial<WorkflowNodeDefinition>) => void;
  onSave: () => void;
  onAutoLayout: () => void;
  onStartRun: () => void;
  onRefreshRun: () => void;
  onAddFiles: (files: FileList | null) => void;
  onRemoveFile: (fileId: string) => void;
  onContextNote: (value: string) => void;
  onOptionalDiff: (value: string) => void;
  onArtifact: (artifact: Artifact) => void;
  onViewMode: (mode: "preview" | "raw") => void;
  onCopyArtifact: () => void;
  onDownloadArtifact: () => void;
  onApprovalComment: (value: string) => void;
  onResolveApproval: (action: ApprovalRequest["action"]) => void;
}) {
  if (!props.workflow) {
    return <section className="studio-page empty-state">Loading workflow...</section>;
  }

  const status = props.selectedNode
    ? props.nodeRunsByNodeId.get(props.selectedNode.id)?.status ?? "pending"
    : "pending";

  return (
    <section className="builder-shell">
      <header className="builder-header">
        <div className="workflow-title-edit">
          <input
            value={props.workflow.name}
            onChange={(event) => props.onWorkflowField("name", event.target.value)}
          />
          <input
            value={props.workflow.description}
            onChange={(event) => props.onWorkflowField("description", event.target.value)}
          />
        </div>
        <div className="workspace-actions">
          <button className="ghost-button" onClick={props.onAutoLayout}>
            <Workflow size={16} />
            Layout
          </button>
          <button className="ghost-button" onClick={props.onSave} disabled={props.isBusy}>
            <Save size={16} />
            Save
          </button>
          <button className="primary-button compact" onClick={props.onStartRun} disabled={props.isBusy}>
            {props.isBusy ? <LoaderCircle className="spin" size={16} /> : <Play size={16} />}
            Run
          </button>
        </div>
      </header>

      <aside className="builder-left">
        <div className="tool-group">
          <h3>Add Node</h3>
          <div className="node-palette">
            {(["input", "agent", "approval", "output"] as WorkflowNodeType[]).map((type) => (
              <button key={type} className="ghost-button" onClick={() => props.onAddNode(type)}>
                <Plus size={15} />
                {type}
              </button>
            ))}
          </div>
        </div>
        <RunInputPanel
          localFiles={props.localFiles}
          contextNote={props.contextNote}
          optionalDiff={props.optionalDiff}
          runState={props.runState}
          onAddFiles={props.onAddFiles}
          onRemoveFile={props.onRemoveFile}
          onContextNote={props.onContextNote}
          onOptionalDiff={props.onOptionalDiff}
          onStartRun={props.onStartRun}
          isBusy={props.isBusy}
        />
      </aside>

      <div className="builder-canvas">
        <ReactFlow
          nodes={props.flowNodes}
          edges={props.flowEdges}
          nodeTypes={nodeTypes}
          onNodesChange={props.onNodesChange}
          onEdgesChange={props.onEdgesChange}
          onConnect={props.onConnect}
          onNodeClick={(_event, node) => props.onSelectNode(node.id)}
          nodesDraggable
          fitView
          minZoom={0.35}
          maxZoom={1.4}
        >
          <Background color="#d1d5db" gap={22} />
          <MiniMap pannable zoomable nodeStrokeWidth={2} />
          <Controls />
        </ReactFlow>
      </div>

      <aside className="builder-right">
        <NodeEditor
          node={props.selectedNode}
          status={status}
          agents={props.agents}
          skills={props.skills}
          artifacts={props.selectedNodeArtifacts}
          selectedArtifact={props.selectedArtifact}
          selectedArtifactId={props.selectedArtifactId}
          viewMode={props.viewMode}
          approvalComment={props.approvalComment}
          isApprovalWaiting={
            props.selectedNode?.type === "approval" &&
            props.runState?.run.status === "waiting_approval" &&
            status === "waiting_approval"
          }
          onUpdateNode={props.onUpdateNode}
          onDeleteNode={props.onDeleteNode}
          onArtifact={props.onArtifact}
          onViewMode={props.onViewMode}
          onCopyArtifact={props.onCopyArtifact}
          onDownloadArtifact={props.onDownloadArtifact}
          onApprovalComment={props.onApprovalComment}
          onResolveApproval={props.onResolveApproval}
        />
      </aside>

      <Timeline events={props.runState?.events ?? []} onRefresh={props.onRefreshRun} />
    </section>
  );
}

function RunInputPanel(props: {
  localFiles: LocalInputFile[];
  contextNote: string;
  optionalDiff: string;
  runState?: RunState;
  isBusy: boolean;
  onAddFiles: (files: FileList | null) => void;
  onRemoveFile: (fileId: string) => void;
  onContextNote: (value: string) => void;
  onOptionalDiff: (value: string) => void;
  onStartRun: () => void;
}) {
  return (
    <section className="run-panel">
      <div className="panel-title">
        <FileText size={17} />
        <span>Run Input</span>
      </div>
      <label className="file-picker">
        Local files
        <input
          type="file"
          multiple
          onChange={(event) => {
            props.onAddFiles(event.target.files);
            event.currentTarget.value = "";
          }}
        />
      </label>
      <div className="local-file-list">
        {props.localFiles.map((file) => (
          <div key={file.id} className="local-file-row">
            <FileText size={15} />
            <span>{file.relativePath || file.name}</span>
            <small>{formatBytes(file.size)}</small>
            <button className="icon-button mini" title="Remove file" onClick={() => props.onRemoveFile(file.id)}>
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
      <label>
        Context
        <input value={props.contextNote} onChange={(event) => props.onContextNote(event.target.value)} />
      </label>
      <label>
        Optional text
        <textarea value={props.optionalDiff} onChange={(event) => props.onOptionalDiff(event.target.value)} />
      </label>
      <button
        className="primary-button"
        disabled={props.isBusy || (props.localFiles.length === 0 && !props.optionalDiff.trim() && !props.contextNote.trim())}
        onClick={props.onStartRun}
      >
        <Play size={16} />
        Run workflow
      </button>
      {props.runState ? (
        <div className={`status-strip status-${props.runState.run.status}`}>
          <span>{props.runState.run.status.replace("_", " ")}</span>
          <small>{props.runState.run.id.slice(0, 8)}</small>
        </div>
      ) : null}
    </section>
  );
}

function NodeEditor(props: {
  node?: WorkflowNodeDefinition;
  status: NodeRunStatus;
  agents: AgentDefinition[];
  skills: SkillDefinition[];
  artifacts: Artifact[];
  selectedArtifact?: ArtifactWithContent;
  selectedArtifactId?: string;
  viewMode: "preview" | "raw";
  approvalComment: string;
  isApprovalWaiting: boolean;
  onUpdateNode: (patch: Partial<WorkflowNodeDefinition>) => void;
  onDeleteNode: () => void;
  onArtifact: (artifact: Artifact) => void;
  onViewMode: (mode: "preview" | "raw") => void;
  onCopyArtifact: () => void;
  onDownloadArtifact: () => void;
  onApprovalComment: (value: string) => void;
  onResolveApproval: (action: ApprovalRequest["action"]) => void;
}) {
  if (!props.node) {
    return <div className="empty-state">Select a node to edit it.</div>;
  }

  const outputFormats = props.node.outputConfig?.formats ?? [];

  return (
    <div className="node-editor">
      <div className="detail-header">
        <div>
          <span className="eyebrow">{props.node.type}</span>
          <h2>{props.node.name}</h2>
        </div>
        <span className={`pill pill-${props.status}`}>{props.status.replace("_", " ")}</span>
      </div>
      <label>
        Name
        <input value={props.node.name} onChange={(event) => props.onUpdateNode({ name: event.target.value })} />
      </label>
      <label>
        Description
        <textarea
          value={props.node.description ?? ""}
          onChange={(event) => props.onUpdateNode({ description: event.target.value })}
        />
      </label>
      {props.node.type === "agent" || props.node.type === "report" ? (
        <>
          <label>
            Agent
            <select
              value={props.node.agentId ?? ""}
              onChange={(event) => props.onUpdateNode({ agentId: event.target.value || undefined })}
            >
              <option value="">Inline mock agent</option>
              {props.agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Prompt
            <textarea value={props.node.prompt ?? ""} onChange={(event) => props.onUpdateNode({ prompt: event.target.value })} />
          </label>
          <SkillPicker node={props.node} skills={props.skills} onUpdateNode={props.onUpdateNode} />
        </>
      ) : null}
      {props.node.type === "output" ? (
        <section className="detail-section flush">
          <h3>Output</h3>
          <label>
            Artifact base name
            <input
              value={props.node.outputConfig?.artifactName ?? "final_output"}
              onChange={(event) =>
                props.onUpdateNode({
                  outputConfig: { formats: outputFormats.length ? outputFormats : ["markdown"], artifactName: event.target.value }
                })
              }
            />
          </label>
          <div className="format-grid">
            {(["markdown", "html", "pdf", "json", "text"] as OutputFormat[]).map((format) => (
              <label key={format} className="check-row">
                <input
                  type="checkbox"
                  checked={outputFormats.includes(format)}
                  onChange={(event) => {
                    const nextFormats = event.target.checked
                      ? [...outputFormats, format]
                      : outputFormats.filter((candidate) => candidate !== format);
                    props.onUpdateNode({
                      outputConfig: {
                        artifactName: props.node?.outputConfig?.artifactName ?? "final_output",
                        formats: nextFormats.length ? nextFormats : ["markdown"]
                      }
                    });
                  }}
                />
                {format}
              </label>
            ))}
          </div>
        </section>
      ) : null}
      {props.isApprovalWaiting ? (
        <section className="approval-box">
          <h3>Human Approval</h3>
          <textarea value={props.approvalComment} onChange={(event) => props.onApprovalComment(event.target.value)} />
          <div className="button-row">
            <button className="success-button" onClick={() => props.onResolveApproval("approve")}>
              <Check size={16} />
              Approve
            </button>
            <button className="danger-button" onClick={() => props.onResolveApproval("reject")}>
              <X size={16} />
              Reject
            </button>
          </div>
        </section>
      ) : null}
      <button className="danger-button full" disabled={props.node.type === "input"} onClick={props.onDeleteNode}>
        <Trash2 size={16} />
        Delete node
      </button>
      <ArtifactPanel
        artifacts={props.artifacts}
        selectedArtifact={props.selectedArtifact}
        selectedArtifactId={props.selectedArtifactId}
        viewMode={props.viewMode}
        onArtifact={props.onArtifact}
        onViewMode={props.onViewMode}
        onCopyArtifact={props.onCopyArtifact}
        onDownloadArtifact={props.onDownloadArtifact}
      />
    </div>
  );
}

function SkillPicker(props: {
  node: WorkflowNodeDefinition;
  skills: SkillDefinition[];
  onUpdateNode: (patch: Partial<WorkflowNodeDefinition>) => void;
}) {
  return (
    <section className="detail-section flush">
      <h3>Skills</h3>
      <div className="format-grid">
        {props.skills.map((skill) => (
          <label key={skill.id} className="check-row">
            <input
              type="checkbox"
              checked={(props.node.skillIds ?? []).includes(skill.id)}
              onChange={(event) => {
                const current = props.node.skillIds ?? [];
                props.onUpdateNode({
                  skillIds: event.target.checked
                    ? [...current, skill.id]
                    : current.filter((skillId) => skillId !== skill.id)
                });
              }}
            />
            {skill.name}
          </label>
        ))}
      </div>
    </section>
  );
}

function ArtifactPanel(props: {
  artifacts: Artifact[];
  selectedArtifact?: ArtifactWithContent;
  selectedArtifactId?: string;
  viewMode: "preview" | "raw";
  onArtifact: (artifact: Artifact) => void;
  onViewMode: (mode: "preview" | "raw") => void;
  onCopyArtifact: () => void;
  onDownloadArtifact: () => void;
}) {
  return (
    <section className="detail-section flush">
      <div className="section-title-row">
        <h3>Artifacts</h3>
        <span className="muted">{props.artifacts.length}</span>
      </div>
      <div className="artifact-list">
        {props.artifacts.map((artifact) => (
          <button
            key={artifact.id}
            className={props.selectedArtifactId === artifact.id ? "artifact-row active" : "artifact-row"}
            onClick={() => props.onArtifact(artifact)}
          >
            <FileText size={15} />
            <span>{artifact.name}</span>
            <small>{artifact.type}</small>
          </button>
        ))}
      </div>
      {props.selectedArtifact ? (
        <div className="artifact-viewer embedded">
          <div className="viewer-toolbar">
            <strong>{props.selectedArtifact.name}</strong>
            <div className="toolbar-actions">
              <div className="segmented">
                <button className={props.viewMode === "preview" ? "active" : ""} onClick={() => props.onViewMode("preview")}>
                  Preview
                </button>
                <button className={props.viewMode === "raw" ? "active" : ""} onClick={() => props.onViewMode("raw")}>
                  Raw
                </button>
              </div>
              <button className="icon-button" title="Copy artifact" onClick={props.onCopyArtifact}>
                <Copy size={15} />
              </button>
              <button className="icon-button" title="Download artifact" onClick={props.onDownloadArtifact}>
                <Download size={15} />
              </button>
            </div>
          </div>
          {props.viewMode === "preview" && props.selectedArtifact.type === "markdown" ? (
            <div className="markdown-preview">
              <ReactMarkdown>{props.selectedArtifact.content}</ReactMarkdown>
            </div>
          ) : (
            <pre className="raw-preview">{props.selectedArtifact.content}</pre>
          )}
        </div>
      ) : null}
    </section>
  );
}

function AgentPage(props: {
  agents: AgentDefinition[];
  skills: SkillDefinition[];
  onCreate: () => void;
  onSave: (agent: AgentDefinition) => void;
  onDelete: (agentId: string) => void;
}) {
  return (
    <section className="studio-page">
      <header className="page-header">
        <div>
          <span className="eyebrow">Agent Library</span>
          <h2>Manage reusable agents</h2>
          <p>Agents can be attached to workflow nodes and carry provider, model, prompt, outputs and skills.</p>
        </div>
        <button className="primary-button compact" onClick={props.onCreate}>
          <Plus size={17} />
          Agent
        </button>
      </header>
      <div className="library-grid">
        {props.agents.map((agent) => (
          <ResourceEditor key={agent.id} title={agent.name} enabled={agent.enabled}>
            <label>
              Name
              <input value={agent.name} onChange={(event) => props.onSave({ ...agent, name: event.target.value })} />
            </label>
            <label>
              Description
              <textarea value={agent.description} onChange={(event) => props.onSave({ ...agent, description: event.target.value })} />
            </label>
            <label>
              Model
              <input value={agent.model} onChange={(event) => props.onSave({ ...agent, model: event.target.value })} />
            </label>
            <label>
              System prompt
              <textarea value={agent.systemPrompt} onChange={(event) => props.onSave({ ...agent, systemPrompt: event.target.value })} />
            </label>
            <div className="button-row">
              <button className="ghost-button" onClick={() => props.onSave({ ...agent, enabled: !agent.enabled })}>
                {agent.enabled ? "Disable" : "Enable"}
              </button>
              <button className="danger-button" onClick={() => props.onDelete(agent.id)}>
                <Trash2 size={15} />
                Delete
              </button>
            </div>
          </ResourceEditor>
        ))}
      </div>
    </section>
  );
}

function SkillPage(props: {
  skills: SkillDefinition[];
  isBusy: boolean;
  onCreate: () => void;
  onScan: () => void;
  onSave: (skill: SkillDefinition) => void;
  onDelete: (skillId: string) => void;
}) {
  return (
    <section className="studio-page">
      <header className="page-header">
        <div>
          <span className="eyebrow">Skill Library</span>
          <h2>Manage local skills</h2>
          <p>Scan local skill folders or create Studio-managed skills for agent prompt context.</p>
        </div>
        <div className="workspace-actions">
          <button className="ghost-button" disabled={props.isBusy} onClick={props.onScan}>
            <RefreshCw size={16} />
            Scan
          </button>
          <button className="primary-button compact" onClick={props.onCreate}>
            <Plus size={17} />
            Skill
          </button>
        </div>
      </header>
      <div className="library-grid">
        {props.skills.map((skill) => (
          <ResourceEditor key={skill.id} title={skill.name} enabled={skill.enabled}>
            <label>
              Name
              <input value={skill.name} onChange={(event) => props.onSave({ ...skill, name: event.target.value })} />
            </label>
            <label>
              Description
              <textarea value={skill.description} onChange={(event) => props.onSave({ ...skill, description: event.target.value })} />
            </label>
            <label>
              Content
              <textarea value={skill.content} onChange={(event) => props.onSave({ ...skill, content: event.target.value })} />
            </label>
            {skill.sourcePath ? <p className="muted path-line">{skill.sourcePath}</p> : null}
            <div className="button-row">
              <button className="ghost-button" onClick={() => props.onSave({ ...skill, enabled: !skill.enabled })}>
                {skill.enabled ? "Disable" : "Enable"}
              </button>
              <button className="danger-button" onClick={() => props.onDelete(skill.id)}>
                <Trash2 size={15} />
                Delete
              </button>
            </div>
          </ResourceEditor>
        ))}
      </div>
    </section>
  );
}

function ResourceEditor(props: { title: string; enabled: boolean; children: ReactNode }) {
  return (
    <article className="resource-card">
      <div className="section-title-row">
        <h3>{props.title}</h3>
        <span className={props.enabled ? "enabled-pill" : "disabled-pill"}>{props.enabled ? "enabled" : "disabled"}</span>
      </div>
      {props.children}
    </article>
  );
}

function WorkflowNodeCard({ data }: NodeProps<Node<WorkflowNodeData>>) {
  return (
    <div className={`flow-node flow-node-${data.status}`}>
      <Handle type="target" position={Position.Top} />
      <div className="node-topline">
        {statusIcon(data.status)}
        <span>{data.nodeType}</span>
      </div>
      <strong>{data.label}</strong>
      <p>{data.description}</p>
      <div className="node-footer">
        <span>{data.status.replace("_", " ")}</span>
        <span>{data.artifactCount} artifact{data.artifactCount === 1 ? "" : "s"}</span>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

function Timeline({ events, onRefresh }: { events: RunEvent[]; onRefresh: () => void }) {
  return (
    <section className="timeline">
      <div className="panel-title">
        <Clock size={17} />
        <span>Timeline</span>
        <button className="icon-button mini" title="Refresh run" onClick={onRefresh}>
          <RefreshCw size={14} />
        </button>
      </div>
      <div className="timeline-scroll">
        {events.length === 0 ? (
          <p className="muted">Run events stream here.</p>
        ) : (
          events.map((event) => (
            <div key={event.id} className="timeline-row">
              <span>{new Date(event.createdAt).toLocaleTimeString()}</span>
              <strong>{event.type.replaceAll("_", " ")}</strong>
              <p>{event.message}</p>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function CliChatDock(props: {
  open: boolean;
  cliStatus?: CliProviderStatusResponse;
  session?: CliChatSession;
  messages: CliChatMessage[];
  input: string;
  includeContext: boolean;
  error?: string;
  onOpen: () => void;
  onClose: () => void;
  onInputChange: (value: string) => void;
  onIncludeContextChange: (value: boolean) => void;
  onSend: () => void;
  onStop: () => void;
}) {
  const isRunning = props.session?.status === "running";
  const providerStatus = isRunning ? "running" : props.cliStatus?.status ?? "not_ready";
  const canSend = props.input.trim().length > 0 && providerStatus === "ready" && !isRunning;
  const statusMessage = isRunning ? "D_RD is running" : props.cliStatus?.message ?? "Checking D_RD connection...";

  if (!props.open) {
    return (
      <button className={`chat-launcher chat-launcher-${providerStatus}`} onClick={props.onOpen}>
        <MessageSquare size={18} />
        <span>CLI Chat</span>
      </button>
    );
  }

  return (
    <section className="cli-chat-dock">
      <header className="cli-chat-header">
        <div className="cli-chat-title">
          <div className="chat-mark">
            <Terminal size={17} />
          </div>
          <div>
            <h2>CLI Chat</h2>
            <p>{statusMessage}</p>
          </div>
        </div>
        <div className="cli-chat-actions">
          <span className={`cli-status cli-status-${providerStatus}`}>{providerStatus.replace("_", " ")}</span>
          <button className="icon-button" title="Collapse chat" onClick={props.onClose}>
            <ChevronDown size={16} />
          </button>
        </div>
      </header>
      <div className="cli-chat-messages">
        {props.messages.length === 0 ? (
          <div className="cli-chat-empty">
            <Bot size={21} />
            <p>Ask D_RD about the current Studio context.</p>
          </div>
        ) : (
          props.messages.map((message) => (
            <article key={message.id} className={`cli-message cli-message-${message.role}`}>
              <div className="cli-message-meta">
                <span>{message.role}</span>
                <time>{formatChatTime(message.createdAt)}</time>
              </div>
              {message.content ? <ReactMarkdown>{message.content}</ReactMarkdown> : <p className="muted">Waiting...</p>}
            </article>
          ))
        )}
      </div>
      {props.error ? <div className="chat-error">{props.error}</div> : null}
      <footer className="cli-chat-footer">
        <label className="context-toggle">
          <input
            type="checkbox"
            checked={props.includeContext}
            onChange={(event) => props.onIncludeContextChange(event.target.checked)}
          />
          Include workflow context
        </label>
        <div className="chat-input-row">
          <textarea value={props.input} onChange={(event) => props.onInputChange(event.target.value)} />
          {isRunning ? (
            <button className="icon-button stop-chat" title="Stop CLI request" onClick={props.onStop}>
              <Square size={15} />
            </button>
          ) : (
            <button className="icon-button send-chat" title="Send message" disabled={!canSend} onClick={props.onSend}>
              <Send size={15} />
            </button>
          )}
        </div>
      </footer>
    </section>
  );
}

function Metric({ title, value }: { title: string; value: number }) {
  return (
    <article className="metric-card">
      <span>{title}</span>
      <strong>{value}</strong>
    </article>
  );
}

function materializeWorkflowFromCanvas(
  workflow: WorkflowDefinition,
  nodes: Node<WorkflowNodeData>[],
  edges: Edge[]
): WorkflowDefinition {
  const dependencies = new Map<string, string[]>();
  for (const edge of edges) {
    dependencies.set(edge.target, [...(dependencies.get(edge.target) ?? []), edge.source]);
  }
  const positions = new Map(nodes.map((node) => [node.id, node.position]));
  return {
    ...workflow,
    status: "active",
    updatedAt: new Date().toISOString(),
    nodes: workflow.nodes.map((node) => ({
      ...node,
      position: positions.get(node.id) ?? node.position,
      depends_on: dependencies.get(node.id) ?? []
    }))
  };
}

function createNode(type: WorkflowNodeType, id: string, dependency?: string): WorkflowNodeDefinition {
  const base = {
    id,
    type,
    name: titleCase(type),
    description: `Custom ${type} node`,
    depends_on: dependency ? [dependency] : [],
    position: { x: 180, y: 180 }
  };
  if (type === "agent") {
    return {
      ...base,
      name: "New Agent",
      prompt: "Analyze the workflow context.",
      outputs: [`${id}.md`],
      outputConfig: { formats: ["markdown"], artifactName: id }
    };
  }
  if (type === "approval") {
    return { ...base, name: "Approval", required_role: "reviewer" };
  }
  if (type === "output") {
    return {
      ...base,
      name: "Output",
      outputs: [`${id}.md`, `${id}.html`, `${id}.pdf`],
      outputConfig: { formats: ["markdown", "html", "pdf"], artifactName: id }
    };
  }
  return { ...base, name: "Input", inputConfig: { acceptsFiles: true, acceptsText: true } };
}

function uniqueNodeId(type: WorkflowNodeType, nodes: WorkflowNodeDefinition[]): string {
  let index = nodes.length + 1;
  let id = `${type}_${index}`;
  while (nodes.some((node) => node.id === id)) {
    index += 1;
    id = `${type}_${index}`;
  }
  return id;
}

function getAutoLayoutPositions(nodes: WorkflowNodeDefinition[]): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  nodes.forEach((node, index) => {
    positions.set(node.id, { x: 120 + index * 310, y: 160 });
  });
  return positions;
}

function groupArtifactsByNode(artifacts: Artifact[]): Map<string, Artifact[]> {
  const map = new Map<string, Artifact[]>();
  for (const artifact of artifacts) {
    map.set(artifact.nodeId, [...(map.get(artifact.nodeId) ?? []), artifact]);
  }
  return map;
}

function statusIcon(status: NodeRunStatus) {
  switch (status) {
    case "running":
      return <LoaderCircle className="spin" size={15} />;
    case "succeeded":
      return <Check size={15} />;
    case "failed":
      return <AlertTriangle size={15} />;
    case "waiting_approval":
      return <Pause size={15} />;
    case "skipped":
      return <X size={15} />;
    default:
      return <Circle size={15} />;
  }
}

async function mutateJson(url: string, method: string, body: unknown) {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error((await response.json()).error ?? `${method} ${url} failed.`);
  }
  return response.json();
}

function artifactMime(type: Artifact["type"]): string {
  switch (type) {
    case "html":
      return "text/html";
    case "pdf":
      return "application/pdf";
    case "json":
      return "application/json";
    default:
      return "text/plain";
  }
}

function readError(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected error.";
}

function upsertCliMessage(messages: CliChatMessage[], nextMessage: CliChatMessage): CliChatMessage[] {
  const existingIndex = messages.findIndex((message) => message.id === nextMessage.id);
  if (existingIndex === -1) {
    return [...messages, nextMessage];
  }
  return messages.map((message, index) => (index === existingIndex ? nextMessage : message));
}

function isCliChatStatus(status: unknown): status is CliChatSession["status"] {
  return status === "idle" || status === "running" || status === "completed" || status === "cancelled" || status === "error";
}

function formatChatTime(value: string): string {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatBytes(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function titleCase(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}
