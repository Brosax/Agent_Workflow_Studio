import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import { Terminal as XTermTerminal } from "@xterm/xterm";
import {
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  getBezierPath,
  useEdgesState,
  useNodesState,
  type Connection,
  type EdgeProps,
  type Node,
  type NodeProps,
  type OnEdgesChange,
  type OnNodeDrag,
  type OnNodesChange,
  type ReactFlowInstance,
  type Viewport
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
  Pause,
  Play,
  Plus,
  RefreshCw,
  Save,
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
  CliProviderStatusResponse,
  CliTerminalEvent,
  CliTerminalInputEvent,
  CreateAgentRequest,
  CreateSkillRequest,
  LocalInputFile,
  NodeRun,
  NodeRunStatus,
  OutputFormat,
  RunEvent,
  RunState,
  SkillDefinition,
  StudioOverview,
  UpdateWorkflowRequest,
  WorkflowDefinition,
  WorkflowConnection,
  WorkflowNode as WorkflowNodeDefinition,
  WorkflowNodePorts,
  WorkflowNodeType,
  WorkflowSummary
} from "@agent-studio/shared";
import {
  createConnectionId,
  getNodePorts,
  normalizeConnectionHandle,
  normalizeWorkflowConnection
} from "@agent-studio/shared";
import {
  dependsOnToEdges,
  edgeToWorkflowConnection,
  reactFlowConnectionToWorkflowConnection,
  workflowConnectionToEdge,
  workflowConnectionsToEdges,
  type WorkflowEdge
} from "./canvasConnectionUtils";
import {
  WORKFLOW_SNAP_GRID,
  findNodeAlignmentSnap,
  getWorkflowLayoutPositions,
  resolveNodeCollision,
  type NodeAlignmentGuide,
  type WorkflowLayoutKind
} from "./workflowLayout";

const DEFAULT_CONTEXT_NOTE = "Run this workflow against the selected local files.";
const MAX_FILE_BYTES = 220_000;
const INITIAL_FLOW_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 };
const nodeTypes = { workflow: WorkflowNodeCard };
const edgeTypes = { workflow: WorkflowConnectionEdge };
const LAYOUT_MENU_OPTIONS: Array<{ kind: WorkflowLayoutKind; label: string }> = [
  { kind: "horizontal", label: "Horizontal" },
  { kind: "vertical", label: "Vertical" },
  { kind: "grid", label: "Grid" },
  { kind: "compact-horizontal", label: "Compact H" },
  { kind: "compact-vertical", label: "Compact V" }
];

type Page = "home" | "builder" | "agents" | "skills";

type WorkflowNodeData = {
  label: string;
  nodeType: WorkflowNodeType;
  status: NodeRunStatus;
  artifactCount: number;
  description?: string;
  ports: WorkflowNodePorts;
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
  const [isSidebarHidden, setIsSidebarHidden] = useState(false);
  const [isDetailsPanelOpen, setIsDetailsPanelOpen] = useState(true);
  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState<Node<WorkflowNodeData>>([]);
  const [flowEdges, setFlowEdges, onEdgesChange] = useEdgesState<WorkflowEdge>([]);
  const [pendingInsertEdgeId, setPendingInsertEdgeId] = useState<string>();
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance<Node<WorkflowNodeData>, WorkflowEdge>>();
  const [flowViewport, setFlowViewport] = useState<Viewport>(INITIAL_FLOW_VIEWPORT);
  const [alignmentGuide, setAlignmentGuide] = useState<NodeAlignmentGuide>();

  const [terminalOpen, setTerminalOpen] = useState(false);
  const [cliStatus, setCliStatus] = useState<CliProviderStatusResponse>();
  const [terminalError, setTerminalError] = useState<string>();

  const selectedNode = workflow?.nodes.find((node) => node.id === selectedNodeId);
  const nodeRunsByNodeId = useMemo(
    () => new Map((runState?.nodeRuns ?? []).map((nodeRun) => [nodeRun.nodeId, nodeRun])),
    [runState?.nodeRuns]
  );
  const artifactsByNodeId = useMemo(() => groupArtifactsByNode(runState?.artifacts ?? []), [runState?.artifacts]);
  const selectedNodeArtifacts = selectedNode ? artifactsByNodeId.get(selectedNode.id) ?? [] : [];

  const deleteEdge = useCallback(
    (edgeId: string) => {
      setFlowEdges((edges) => edges.filter((edge) => edge.id !== edgeId));
      setWorkflow((current) => {
        if (!current) {
          return current;
        }
        const connections = getWorkflowDisplayConnections(current).filter(
          (connection) => createConnectionId(connection.source, connection.sourceHandle, connection.target, connection.targetHandle) !== edgeId
        );
        return {
          ...current,
          nodes: applyConnectionDependencies(current.nodes, connections),
          connections
        };
      });
    },
    [setFlowEdges]
  );

  const beginInsertOnEdge = useCallback((edgeId: string) => {
    setPendingInsertEdgeId(edgeId);
    setError(undefined);
  }, []);

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
    void refreshCliStatus().catch((caught: unknown) => setTerminalError(readError(caught)));
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
          description: node.description,
          ports: getNodePorts(node)
        }
      }))
    );

    const edgeOptions = { nodeRunsByNodeId, onDeleteEdge: deleteEdge, onInsertEdge: beginInsertOnEdge };
    setFlowEdges(
      workflow.connections?.length
        ? workflowConnectionsToEdges(workflow, edgeOptions)
        : dependsOnToEdges(workflow, edgeOptions)
    );
  }, [artifactsByNodeId, beginInsertOnEdge, deleteEdge, nodeRunsByNodeId, setFlowEdges, setFlowNodes, workflow]);

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
    const baseNode = createNode(type, id);
    const currentConnections = flowEdges.map(edgeToWorkflowConnection);

    if (pendingInsertEdgeId) {
      const edge = flowEdges.find((candidate) => candidate.id === pendingInsertEdgeId);
      const inputPort = getNodePorts(baseNode).inputs[0];
      const outputPort = getNodePorts(baseNode).outputs[0];
      if (!edge || !inputPort || !outputPort) {
        setError("Only nodes with both input and output ports can be inserted on an existing connection.");
        setPendingInsertEdgeId(undefined);
        return;
      }

      const sourcePosition = flowNodes.find((node) => node.id === edge.source)?.position;
      const targetPosition = flowNodes.find((node) => node.id === edge.target)?.position;
      const node = {
        ...baseNode,
        depends_on: [edge.source],
        position: sourcePosition && targetPosition
          ? { x: (sourcePosition.x + targetPosition.x) / 2, y: (sourcePosition.y + targetPosition.y) / 2 + 90 }
          : baseNode.position
      };
      const nextNodes = [...workflow.nodes, node];
      const sourceHandle = normalizeConnectionHandle(edge.sourceHandle, "outputs");
      const targetHandle = normalizeConnectionHandle(edge.targetHandle, "inputs");
      const nextConnections = currentConnections
        .filter((connection) => connection.id !== pendingInsertEdgeId)
        .concat([
          {
            id: createConnectionId(edge.source, sourceHandle, node.id, inputPort.handle),
            source: edge.source,
            target: node.id,
            sourceHandle,
            targetHandle: inputPort.handle
          },
          {
            id: createConnectionId(node.id, outputPort.handle, edge.target, targetHandle),
            source: node.id,
            target: edge.target,
            sourceHandle: outputPort.handle,
            targetHandle
          }
        ]);
      setWorkflow({ ...workflow, nodes: applyConnectionDependencies(nextNodes, nextConnections), connections: nextConnections });
      setPendingInsertEdgeId(undefined);
      setSelectedNodeId(id);
      setIsDetailsPanelOpen(true);
      return;
    }

    const inputPort = getNodePorts(baseNode).inputs[0];
    const previousOutputPort = previousNode ? getNodePorts(previousNode).outputs[0] : undefined;
    const node = {
      ...baseNode,
      depends_on: previousNode && inputPort && previousOutputPort ? [previousNode.id] : [],
      position: previousNode?.position ? { x: previousNode.position.x + 300, y: previousNode.position.y } : baseNode.position
    };
    const nextConnections = [...currentConnections];
    if (previousNode && inputPort && previousOutputPort) {
      nextConnections.push({
        id: createConnectionId(previousNode.id, previousOutputPort.handle, node.id, inputPort.handle),
        source: previousNode.id,
        target: node.id,
        sourceHandle: previousOutputPort.handle,
        targetHandle: inputPort.handle
      });
    }
    const nextNodes = [...workflow.nodes, node];
    setWorkflow({ ...workflow, nodes: applyConnectionDependencies(nextNodes, nextConnections), connections: nextConnections });
    setSelectedNodeId(id);
    setIsDetailsPanelOpen(true);
  }

  function deleteSelectedNode() {
    if (!workflow || !selectedNode || selectedNode.type === "input" || selectedNode.type === "trigger") {
      return;
    }
    const nodes = workflow.nodes
      .filter((node) => node.id !== selectedNode.id)
      .map((node) => ({
        ...node,
        depends_on: (node.depends_on ?? []).filter((dependency) => dependency !== selectedNode.id)
      }));
    setFlowEdges((edges) => edges.filter((edge) => edge.source !== selectedNode.id && edge.target !== selectedNode.id));
    setWorkflow({
      ...workflow,
      nodes: applyConnectionDependencies(
        nodes,
        (workflow.connections?.length ? workflow.connections : flowEdges.map(edgeToWorkflowConnection)).filter(
          (connection) => connection.source !== selectedNode.id && connection.target !== selectedNode.id
        )
      ),
      connections: (workflow.connections?.length ? workflow.connections : flowEdges.map(edgeToWorkflowConnection)).filter(
        (connection) => connection.source !== selectedNode.id && connection.target !== selectedNode.id
      )
    });
    setSelectedNodeId(nodes[0]?.id);
  }

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!workflow) {
        return;
      }

      const result = reactFlowConnectionToWorkflowConnection(connection, workflow);
      if (!result.connection) {
        setError(result.error ?? "Connection is not valid.");
        return;
      }
      const workflowConnection = result.connection;

      const nextEdge = workflowConnectionToEdge(workflow, workflowConnection, {
        nodeRunsByNodeId,
        onDeleteEdge: deleteEdge,
        onInsertEdge: beginInsertOnEdge
      });
      if (flowEdges.some((edge) => edge.id === nextEdge.id)) {
        setError("That connection already exists.");
        return;
      }
      setError(undefined);
      setFlowEdges((edges) => [...edges, nextEdge]);
      setWorkflow((current) => {
        if (!current) {
          return current;
        }
        const connections = [...getWorkflowDisplayConnections(current), workflowConnection];
        return {
          ...current,
          nodes: applyConnectionDependencies(current.nodes, connections),
          connections
        };
      });
    },
    [beginInsertOnEdge, deleteEdge, flowEdges, nodeRunsByNodeId, setFlowEdges, workflow]
  );

  function autoLayoutNodes(kind: WorkflowLayoutKind) {
    if (!workflow) {
      return;
    }
    const workflowForLayout = materializeWorkflowFromCanvas(workflow, flowNodes, flowEdges);
    const positions = getWorkflowLayoutPositions(workflowForLayout, kind);
    setFlowNodes((currentNodes) =>
      currentNodes.map((node) => ({
        ...node,
        position: positions.get(node.id) ?? node.position
      }))
    );
    window.setTimeout(() => {
      void flowInstance?.fitView({ padding: 0.18, duration: 220 });
    }, 0);
  }

  const fitWorkflowView = useCallback(() => {
    void flowInstance?.fitView({ padding: 0.18, duration: 220 });
  }, [flowInstance]);

  const onNodeDrag = useCallback<OnNodeDrag<Node<WorkflowNodeData>>>(
    (_event, node, nodes) => {
      const otherPositions = new Map(
        nodes.filter((candidate) => candidate.id !== node.id).map((candidate) => [candidate.id, candidate.position])
      );
      const snap = findNodeAlignmentSnap(node.id, node.position, otherPositions);
      setAlignmentGuide(snap.guide.vertical === undefined && snap.guide.horizontal === undefined ? undefined : snap.guide);
    },
    []
  );

  const onNodeDragStop = useCallback<OnNodeDrag<Node<WorkflowNodeData>>>(
    (_event, node, nodes) => {
      const otherPositions = new Map(
        nodes.filter((candidate) => candidate.id !== node.id).map((candidate) => [candidate.id, candidate.position])
      );
      const snap = findNodeAlignmentSnap(node.id, node.position, otherPositions);
      const resolved = resolveNodeCollision(node.id, snap.position, otherPositions);
      setAlignmentGuide(undefined);
      if (resolved.x !== node.position.x || resolved.y !== node.position.y) {
        setFlowNodes((currentNodes) =>
          currentNodes.map((candidate) =>
            candidate.id === node.id ? { ...candidate, position: resolved } : candidate
          )
        );
      }
    },
    [setFlowNodes]
  );

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

  async function openTerminal() {
    setTerminalOpen(true);
    setTerminalError(undefined);
    try {
      await refreshCliStatus();
    } catch (caught) {
      setTerminalError(readError(caught));
    }
  }

  async function refreshTerminalStatus() {
    setTerminalError(undefined);
    try {
      await refreshCliStatus();
    } catch (caught) {
      setTerminalError(readError(caught));
    }
  }

  return (
    <main className={isSidebarHidden ? "studio-app studio-app-sidebar-hidden" : "studio-app"}>
      {isSidebarHidden ? (
        <button className="sidebar-reopen" title="Show navigation" onClick={() => setIsSidebarHidden(false)}>
          EA
        </button>
      ) : null}
      <aside className="studio-sidebar">
        <div className="studio-brand">
          <div className="brand-mark">EA</div>
          <div>
            <h1>Agent Workflow Studio</h1>
            <p>Local workflow lab</p>
          </div>
          <button className="icon-button sidebar-hide-button" title="Hide navigation" onClick={() => setIsSidebarHidden(true)}>
            <X size={15} />
          </button>
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
          artifactsByNodeId={artifactsByNodeId}
          pendingInsertEdgeId={pendingInsertEdgeId}
          detailsPanelOpen={isDetailsPanelOpen}
          flowViewport={flowViewport}
          alignmentGuide={alignmentGuide}
          isBusy={isBusy}
          onWorkflowField={updateWorkflowField}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onSelectNode={(nodeId) => {
            setSelectedNodeId(nodeId);
            setIsDetailsPanelOpen(true);
          }}
          onAddNode={addWorkflowNode}
          onDeleteNode={deleteSelectedNode}
          onUpdateNode={updateSelectedNode}
          onSave={() => void saveWorkflow()}
          onAutoLayout={autoLayoutNodes}
          onFitView={fitWorkflowView}
          onFlowInit={setFlowInstance}
          onViewportMove={setFlowViewport}
          onNodeDrag={onNodeDrag}
          onNodeDragStop={onNodeDragStop}
          onToggleDetailsPanel={() => setIsDetailsPanelOpen((current) => !current)}
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

      <CliTerminalDock
        open={terminalOpen}
        cliStatus={cliStatus}
        error={terminalError}
        onOpen={() => void openTerminal()}
        onClose={() => setTerminalOpen(false)}
        onRefreshStatus={() => void refreshTerminalStatus()}
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
  flowEdges: WorkflowEdge[];
  nodeRunsByNodeId: Map<string, NodeRun>;
  artifactsByNodeId: Map<string, Artifact[]>;
  pendingInsertEdgeId?: string;
  detailsPanelOpen: boolean;
  flowViewport: Viewport;
  alignmentGuide?: NodeAlignmentGuide;
  isBusy: boolean;
  onWorkflowField: <K extends keyof WorkflowDefinition>(field: K, value: WorkflowDefinition[K]) => void;
  onNodesChange: OnNodesChange<Node<WorkflowNodeData>>;
  onEdgesChange: OnEdgesChange<WorkflowEdge>;
  onConnect: (connection: Connection) => void;
  onSelectNode: (nodeId: string) => void;
  onAddNode: (type: WorkflowNodeType) => void;
  onDeleteNode: () => void;
  onUpdateNode: (patch: Partial<WorkflowNodeDefinition>) => void;
  onSave: () => void;
  onAutoLayout: (kind: WorkflowLayoutKind) => void;
  onFitView: () => void;
  onFlowInit: (instance: ReactFlowInstance<Node<WorkflowNodeData>, WorkflowEdge>) => void;
  onViewportMove: (viewport: Viewport) => void;
  onNodeDrag: OnNodeDrag<Node<WorkflowNodeData>>;
  onNodeDragStop: OnNodeDrag<Node<WorkflowNodeData>>;
  onToggleDetailsPanel: () => void;
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
  const [layoutMenuOpen, setLayoutMenuOpen] = useState(false);

  if (!props.workflow) {
    return <section className="studio-page empty-state">Loading workflow...</section>;
  }

  const status = props.selectedNode
    ? props.nodeRunsByNodeId.get(props.selectedNode.id)?.status ?? "pending"
    : "pending";
  const verticalGuideLeft = props.alignmentGuide?.vertical === undefined
    ? undefined
    : props.alignmentGuide.vertical * props.flowViewport.zoom + props.flowViewport.x;
  const horizontalGuideTop = props.alignmentGuide?.horizontal === undefined
    ? undefined
    : props.alignmentGuide.horizontal * props.flowViewport.zoom + props.flowViewport.y;

  return (
    <section className={props.detailsPanelOpen ? "builder-shell" : "builder-shell builder-shell-detail-collapsed"}>
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
          <div className="layout-menu">
            <button className="ghost-button" onClick={() => setLayoutMenuOpen((current) => !current)}>
              <Workflow size={16} />
              Layout
              <ChevronDown size={15} />
            </button>
            {layoutMenuOpen ? (
              <div className="layout-menu-popover">
                {LAYOUT_MENU_OPTIONS.map((option) => (
                  <button
                    key={option.kind}
                    onClick={() => {
                      props.onAutoLayout(option.kind);
                      setLayoutMenuOpen(false);
                    }}
                  >
                    {option.label}
                  </button>
                ))}
                <button
                  onClick={() => {
                    props.onFitView();
                    setLayoutMenuOpen(false);
                  }}
                >
                  Fit View
                </button>
              </div>
            ) : null}
          </div>
          <button className="ghost-button" onClick={props.onSave} disabled={props.isBusy}>
            <Save size={16} />
            Save
          </button>
          <button className="ghost-button" onClick={props.onToggleDetailsPanel}>
            {props.detailsPanelOpen ? <X size={16} /> : <FileText size={16} />}
            {props.detailsPanelOpen ? "Hide details" : "Show details"}
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
          {props.pendingInsertEdgeId ? (
            <div className="insert-hint">Pick a processing node to insert on the selected edge.</div>
          ) : null}
          <div className="node-palette-group">
            <span className="palette-label">Trigger</span>
            <button className="ghost-button" onClick={() => props.onAddNode("trigger")}>
              <Play size={15} /> Trigger
            </button>
          </div>
          <div className="node-palette-group">
            <span className="palette-label">Input</span>
            <button className="ghost-button" onClick={() => props.onAddNode("input")}>
              <Plus size={15} /> Input
            </button>
            <button className="ghost-button" onClick={() => props.onAddNode("document_loader")}>
              <FileText size={15} /> Document Loader
            </button>
          </div>
          <div className="node-palette-group">
            <span className="palette-label">Agent</span>
            <button className="ghost-button" onClick={() => props.onAddNode("model_selector")}>
              <Sparkles size={15} /> Model Selector
            </button>
            <button className="ghost-button" onClick={() => props.onAddNode("agent")}>
              <Bot size={15} /> Agent
            </button>
            <button className="ghost-button" onClick={() => props.onAddNode("report")}>
              <FileText size={15} /> Report Agent
            </button>
          </div>
          <div className="node-palette-group">
            <span className="palette-label">Tools</span>
            <button className="ghost-button" onClick={() => props.onAddNode("tool_executor")}>
              <Terminal size={15} /> Tool Executor
            </button>
            <button className="ghost-button" onClick={() => props.onAddNode("retriever")}>
              <Sparkles size={15} /> Retriever
            </button>
          </div>
          <div className="node-palette-group">
            <span className="palette-label">Control</span>
            <button className="ghost-button" onClick={() => props.onAddNode("condition")}>
              <ChevronDown size={15} /> If / Condition
            </button>
            <button className="ghost-button" onClick={() => props.onAddNode("merge")}>
              <Plus size={15} /> Merge
            </button>
            <button className="ghost-button" onClick={() => props.onAddNode("filter")}>
              <Circle size={15} /> Filter
            </button>
            <button className="ghost-button" onClick={() => props.onAddNode("approval")}>
              <Check size={15} /> Human Approval
            </button>
          </div>
          <div className="node-palette-group">
            <span className="palette-label">Output</span>
            <button className="ghost-button" onClick={() => props.onAddNode("output")}>
              <FileText size={15} /> Artifact Output
            </button>
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
          edgeTypes={edgeTypes}
          onNodesChange={props.onNodesChange}
          onEdgesChange={props.onEdgesChange}
          onConnect={props.onConnect}
          onNodeClick={(_event, node) => props.onSelectNode(node.id)}
          onInit={props.onFlowInit}
          onMove={(_event, viewport) => props.onViewportMove(viewport)}
          onNodeDrag={props.onNodeDrag}
          onNodeDragStop={props.onNodeDragStop}
          nodesDraggable
          snapToGrid
          snapGrid={WORKFLOW_SNAP_GRID}
          fitView
          fitViewOptions={{ padding: 0.18 }}
          minZoom={0.35}
          maxZoom={1.4}
        >
          <Background color="#d1d5db" gap={22} />
          <MiniMap pannable zoomable nodeStrokeWidth={2} />
          <Controls />
        </ReactFlow>
        {verticalGuideLeft !== undefined ? (
          <div className="alignment-guide-vertical" style={{ left: verticalGuideLeft }} />
        ) : null}
        {horizontalGuideTop !== undefined ? (
          <div className="alignment-guide-horizontal" style={{ top: horizontalGuideTop }} />
        ) : null}
      </div>

      <aside className={props.detailsPanelOpen ? "builder-right" : "builder-right builder-right-collapsed"}>
        <button className="icon-button details-close-button" title="Hide details" onClick={props.onToggleDetailsPanel}>
          <X size={15} />
        </button>
        <NodeEditor
          node={props.selectedNode}
          workflow={props.workflow}
          status={status}
          agents={props.agents}
          skills={props.skills}
          nodeRunsByNodeId={props.nodeRunsByNodeId}
          artifactsByNodeId={props.artifactsByNodeId}
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
  workflow: WorkflowDefinition;
  status: NodeRunStatus;
  agents: AgentDefinition[];
  skills: SkillDefinition[];
  nodeRunsByNodeId: Map<string, NodeRun>;
  artifactsByNodeId: Map<string, Artifact[]>;
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
  const [activeTab, setActiveTab] = useState<"parameters" | "inputs" | "outputs" | "run">("parameters");

  useEffect(() => {
    setActiveTab("parameters");
  }, [props.node?.id]);

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
      <div className="detail-tabs">
        {(["parameters", "inputs", "outputs", "run"] as const).map((tab) => (
          <button key={tab} className={activeTab === tab ? "active" : ""} onClick={() => setActiveTab(tab)}>
            {titleCase(tab)}
          </button>
        ))}
      </div>
      {activeTab === "parameters" ? (
        <>
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
      {props.node.type === "model_selector" ? (
        <section className="detail-section flush">
          <h3>Model Configuration</h3>
          <label>
            Provider
            <select
              value={props.node.modelSelectorConfig?.provider ?? "mock"}
              onChange={(event) =>
                props.onUpdateNode({
                  modelSelectorConfig: { provider: event.target.value as import("@agent-studio/shared").ModelProvider, model: props.node?.modelSelectorConfig?.model ?? "" }
                })
              }
            >
              <option value="mock">Mock</option>
              <option value="codex_cli">Codex CLI</option>
              <option value="openai_responses">OpenAI Responses</option>
              <option value="ollama">Ollama</option>
              <option value="openai_compatible">OpenAI Compatible</option>
            </select>
          </label>
          <label>
            Model
            <input
              value={props.node.modelSelectorConfig?.model ?? ""}
              onChange={(event) =>
                props.onUpdateNode({
                  modelSelectorConfig: { provider: props.node?.modelSelectorConfig?.provider ?? "mock", model: event.target.value }
                })
              }
            />
          </label>
        </section>
      ) : null}
      {props.node.type === "tool_executor" ? (
        <section className="detail-section flush">
          <h3>Tool Configuration</h3>
          <label>
            Tool
            <select
              value={props.node.toolExecutorConfig?.toolKind ?? "list_input_files"}
              onChange={(event) =>
                props.onUpdateNode({
                  toolExecutorConfig: { toolKind: event.target.value as import("@agent-studio/shared").ToolKind }
                })
              }
            >
              <option value="list_input_files">List Input Files</option>
              <option value="git_status">Git Status</option>
              <option value="d_rd_cli_status">D_RD CLI Status</option>
            </select>
          </label>
        </section>
      ) : null}
      {props.node.type === "document_loader" ? (
        <section className="detail-section flush">
          <h3>Document Source</h3>
          <label>
            Source
            <select
              value={props.node.documentLoaderConfig?.source ?? "both"}
              onChange={(event) =>
                props.onUpdateNode({
                  documentLoaderConfig: { source: event.target.value as import("@agent-studio/shared").DocumentSource }
                })
              }
            >
              <option value="input_files">Input Files</option>
              <option value="upstream_artifacts">Upstream Artifacts</option>
              <option value="both">Both</option>
            </select>
          </label>
        </section>
      ) : null}
      {props.node.type === "retriever" ? (
        <section className="detail-section flush">
          <h3>Retriever Configuration</h3>
          <label>
            Query
            <input
              value={props.node.retrieverConfig?.query ?? ""}
              placeholder="Uses context note if empty"
              onChange={(event) =>
                props.onUpdateNode({
                  retrieverConfig: { ...props.node?.retrieverConfig, query: event.target.value, topK: props.node?.retrieverConfig?.topK ?? 5 }
                })
              }
            />
          </label>
          <label>
            Top K
            <input
              type="number"
              min={1}
              max={20}
              value={props.node.retrieverConfig?.topK ?? 5}
              onChange={(event) =>
                props.onUpdateNode({
                  retrieverConfig: { ...props.node?.retrieverConfig, query: props.node?.retrieverConfig?.query, topK: Number(event.target.value) }
                })
              }
            />
          </label>
        </section>
      ) : null}
      {props.node.type === "condition" ? (
        <section className="detail-section flush">
          <h3>Condition Configuration</h3>
          <label>
            Source
            <select
              value={props.node.conditionConfig?.source ?? "context_note"}
              onChange={(event) =>
                props.onUpdateNode({
                  conditionConfig: { ...props.node?.conditionConfig, source: event.target.value as import("@agent-studio/shared").ConditionSource, operator: props.node?.conditionConfig?.operator ?? "exists" }
                })
              }
            >
              <option value="context_note">Context Note</option>
              <option value="optional_diff">Optional Diff</option>
              <option value="combined_artifacts">Combined Artifacts</option>
            </select>
          </label>
          <label>
            Operator
            <select
              value={props.node.conditionConfig?.operator ?? "exists"}
              onChange={(event) =>
                props.onUpdateNode({
                  conditionConfig: { ...props.node?.conditionConfig, source: props.node?.conditionConfig?.source ?? "context_note", operator: event.target.value as import("@agent-studio/shared").ConditionOperator }
                })
              }
            >
              <option value="exists">Exists</option>
              <option value="contains">Contains</option>
              <option value="not_contains">Not Contains</option>
              <option value="equals">Equals</option>
            </select>
          </label>
          {props.node.conditionConfig?.operator !== "exists" ? (
            <label>
              Value
              <input
                value={props.node.conditionConfig?.value ?? ""}
                onChange={(event) =>
                  props.onUpdateNode({
                    conditionConfig: { ...props.node?.conditionConfig, source: props.node?.conditionConfig?.source ?? "context_note", operator: props.node?.conditionConfig?.operator ?? "exists", value: event.target.value }
                  })
                }
              />
            </label>
          ) : null}
        </section>
      ) : null}
      {props.node.type === "merge" ? (
        <section className="detail-section flush">
          <h3>Merge Strategy</h3>
          <label>
            Strategy
            <select
              value={props.node.mergeConfig?.strategy ?? "concat_artifacts"}
              onChange={(event) =>
                props.onUpdateNode({
                  mergeConfig: { strategy: event.target.value as import("@agent-studio/shared").MergeStrategy }
                })
              }
            >
              <option value="concat_artifacts">Concat Artifacts</option>
            </select>
          </label>
        </section>
      ) : null}
      {props.node.type === "filter" ? (
        <section className="detail-section flush">
          <h3>Filter Configuration</h3>
          <label>
            Operator
            <select
              value={props.node.filterConfig?.operator ?? "contains"}
              onChange={(event) =>
                props.onUpdateNode({
                  filterConfig: { operator: event.target.value as import("@agent-studio/shared").FilterOperator, value: props.node?.filterConfig?.value ?? "" }
                })
              }
            >
              <option value="contains">Contains</option>
              <option value="not_contains">Not Contains</option>
            </select>
          </label>
          <label>
            Value
            <input
              value={props.node.filterConfig?.value ?? ""}
              onChange={(event) =>
                props.onUpdateNode({
                  filterConfig: { operator: props.node?.filterConfig?.operator ?? "contains", value: event.target.value }
                })
              }
            />
          </label>
        </section>
      ) : null}
      <button className="danger-button full" disabled={props.node.type === "input" || props.node.type === "trigger"} onClick={props.onDeleteNode}>
        <Trash2 size={16} />
        Delete node
      </button>
        </>
      ) : null}
      {activeTab === "inputs" ? (
        <NodeConnectionPanel
          node={props.node}
          workflow={props.workflow}
          direction="inputs"
          nodeRunsByNodeId={props.nodeRunsByNodeId}
          artifactsByNodeId={props.artifactsByNodeId}
        />
      ) : null}
      {activeTab === "outputs" ? (
        <>
          <NodeConnectionPanel
            node={props.node}
            workflow={props.workflow}
            direction="outputs"
            nodeRunsByNodeId={props.nodeRunsByNodeId}
            artifactsByNodeId={props.artifactsByNodeId}
          />
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
        </>
      ) : null}
      {activeTab === "run" ? (
        <NodeRunPanel
          node={props.node}
          status={props.status}
          artifacts={props.artifacts}
          approvalComment={props.approvalComment}
          isApprovalWaiting={props.isApprovalWaiting}
          onApprovalComment={props.onApprovalComment}
          onResolveApproval={props.onResolveApproval}
        />
      ) : null}
    </div>
  );
}

function NodeConnectionPanel(props: {
  node: WorkflowNodeDefinition;
  workflow: WorkflowDefinition;
  direction: "inputs" | "outputs";
  nodeRunsByNodeId: Map<string, NodeRun>;
  artifactsByNodeId: Map<string, Artifact[]>;
}) {
  const connections = getWorkflowDisplayConnections(props.workflow).filter((connection) =>
    props.direction === "inputs" ? connection.target === props.node.id : connection.source === props.node.id
  );
  const title = props.direction === "inputs" ? "Inputs" : "Outputs";

  return (
    <section className="detail-section flush">
      <div className="section-title-row">
        <h3>{title}</h3>
        <span className="muted">{connections.length}</span>
      </div>
      <div className="connection-list">
        {connections.length === 0 ? <p className="muted">No {title.toLowerCase()} connected.</p> : null}
        {connections.map((connection) => {
          const sourceNode = props.workflow.nodes.find((node) => node.id === connection.source);
          const targetNode = props.workflow.nodes.find((node) => node.id === connection.target);
          const peerNode = props.direction === "inputs" ? sourceNode : targetNode;
          const peerStatus = peerNode ? props.nodeRunsByNodeId.get(peerNode.id)?.status ?? "pending" : "pending";
          const peerArtifactCount = peerNode ? props.artifactsByNodeId.get(peerNode.id)?.length ?? 0 : 0;
          return (
            <article key={connection.id} className="connection-row">
              <div className="connection-node-name">
                {statusIcon(peerStatus)}
                <strong>{peerNode?.name ?? "Missing node"}</strong>
                <span className={`pill pill-${peerStatus}`}>{peerStatus.replace("_", " ")}</span>
              </div>
              <div className="connection-meta">
                <span className="port-chip">{getConnectionPortLabel(sourceNode, "outputs", connection.sourceHandle)}</span>
                <span className="connection-arrow">to</span>
                <span className="port-chip">{getConnectionPortLabel(targetNode, "inputs", connection.targetHandle)}</span>
                <small>{peerArtifactCount} artifact{peerArtifactCount === 1 ? "" : "s"}</small>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function NodeRunPanel(props: {
  node: WorkflowNodeDefinition;
  status: NodeRunStatus;
  artifacts: Artifact[];
  approvalComment: string;
  isApprovalWaiting: boolean;
  onApprovalComment: (value: string) => void;
  onResolveApproval: (action: ApprovalRequest["action"]) => void;
}) {
  return (
    <>
      <section className="detail-section flush">
        <div className="section-title-row">
          <h3>Run</h3>
          <span className={`pill pill-${props.status}`}>{props.status.replace("_", " ")}</span>
        </div>
        <div className="run-summary-grid">
          <div>
            <span>Node type</span>
            <strong>{props.node.type}</strong>
          </div>
          <div>
            <span>Artifacts</span>
            <strong>{props.artifacts.length}</strong>
          </div>
        </div>
      </section>
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
    </>
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
    <div className={`flow-node flow-node-${data.nodeType} flow-node-${data.status}`}>
      <NodePortHandles ports={data.ports.inputs} type="target" position={Position.Left} />
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
      <NodePortHandles ports={data.ports.outputs} type="source" position={Position.Right} />
    </div>
  );
}

function NodePortHandles(props: {
  ports: WorkflowNodePorts["inputs"];
  type: "source" | "target";
  position: Position.Left | Position.Right;
}) {
  return (
    <>
      {props.ports.map((port, index) => {
        const top = `${((index + 1) / (props.ports.length + 1)) * 100}%`;
        const side = props.position === Position.Left ? "input" : "output";
        return (
          <div key={port.handle}>
            <Handle
              type={props.type}
              id={port.handle}
              position={props.position}
              className={`node-handle node-handle-${side}`}
              style={{ top }}
            />
            <span className={`node-port-label node-port-label-${side}`} style={{ top }}>
              {port.label}
            </span>
          </div>
        );
      })}
    </>
  );
}

function WorkflowConnectionEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  data
}: EdgeProps<WorkflowEdge>) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition
  });

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} />
      <EdgeLabelRenderer>
        <div className="workflow-edge-actions nodrag nopan" style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}>
          <button className="icon-button mini" title="Insert node" onClick={() => data?.onInsertEdge?.(id)}>
            <Plus size={13} />
          </button>
          <button className="icon-button mini danger-icon" title="Delete connection" onClick={() => data?.onDeleteEdge?.(id)}>
            <X size={13} />
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
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

function CliTerminalDock(props: {
  open: boolean;
  cliStatus?: CliProviderStatusResponse;
  error?: string;
  onOpen: () => void;
  onClose: () => void;
  onRefreshStatus: () => void;
}) {
  const terminalHostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XTermTerminal>();
  const socketRef = useRef<WebSocket>();
  const lastNotReadyMessageRef = useRef<string>();
  const [connectionState, setConnectionState] = useState<"idle" | "connecting" | "connected" | "closed" | "error">("idle");
  const providerStatus = connectionState === "connected" || connectionState === "connecting"
    ? "running"
    : props.cliStatus?.status ?? "not_ready";
  const statusMessage = props.error ?? props.cliStatus?.message ?? "Checking D_RD connection...";
  const canConnect = props.cliStatus?.status === "ready" && connectionState !== "connected" && connectionState !== "connecting";

  const writeLine = useCallback((line = "") => {
    terminalRef.current?.writeln(line);
  }, []);

  const writeOutput = useCallback((data: string) => {
    terminalRef.current?.write(data);
  }, []);

  const disconnect = useCallback(() => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "interrupt" } satisfies CliTerminalInputEvent));
    }
    socket?.close();
    socketRef.current = undefined;
    setConnectionState("closed");
    props.onRefreshStatus();
  }, [props]);

  const connect = useCallback(() => {
    if (socketRef.current?.readyState === WebSocket.OPEN || socketRef.current?.readyState === WebSocket.CONNECTING) {
      return;
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${window.location.host}/ws/cli/terminal`);
    socketRef.current = socket;
    setConnectionState("connecting");
    writeLine("");
    writeLine(`[${formatTerminalTime()}] connecting to D_RD terminal...`);

    socket.onopen = () => {
      setConnectionState("connected");
    };

    socket.onmessage = (messageEvent) => {
      const event = JSON.parse(String(messageEvent.data)) as CliTerminalEvent;
      if (event.type === "output" && event.data) {
        writeOutput(event.data);
      }
      if (event.type === "status" && event.message) {
        writeLine(`[${formatTerminalTime()}] ${event.message}`);
      }
      if (event.type === "error") {
        setConnectionState("error");
        writeLine("");
        writeLine(event.data?.trimEnd() || `[${formatTerminalTime()}] ${event.message ?? "D_RD terminal error."}`);
      }
      if (event.type === "exit") {
        setConnectionState(event.status === "error" ? "error" : "closed");
        if (event.data) {
          writeOutput(event.data);
        }
        props.onRefreshStatus();
      }
    };

    socket.onerror = () => {
      setConnectionState("error");
      writeLine(`[${formatTerminalTime()}] D_RD terminal socket error.`);
      props.onRefreshStatus();
    };

    socket.onclose = () => {
      socketRef.current = undefined;
      setConnectionState((current) => (current === "error" ? current : "closed"));
      props.onRefreshStatus();
    };
  }, [props, writeLine, writeOutput]);

  useEffect(() => {
    if (!props.open || !terminalHostRef.current || terminalRef.current) {
      return;
    }

    const terminal = new XTermTerminal({
      convertEol: true,
      cursorBlink: true,
      fontFamily: "Consolas, 'Cascadia Mono', 'SFMono-Regular', monospace",
      fontSize: 13,
      lineHeight: 1.25,
      theme: {
        background: "#0b1020",
        foreground: "#dbeafe",
        cursor: "#93c5fd",
        selectionBackground: "#334155"
      }
    });
    const dataDisposable = terminal.onData((data) => {
      const socket = socketRef.current;
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "input", data } satisfies CliTerminalInputEvent));
      }
    });

    terminal.open(terminalHostRef.current);
    terminal.writeln("D_RD Terminal");
    terminal.writeln("Direct terminal connection to the D_RD CLI.");
    terminal.writeln("");
    terminalRef.current = terminal;

    return () => {
      dataDisposable.dispose();
      socketRef.current?.close();
      socketRef.current = undefined;
      terminal.dispose();
      terminalRef.current = undefined;
      lastNotReadyMessageRef.current = undefined;
      setConnectionState("idle");
    };
  }, [props.open]);

  useEffect(() => {
    if (!props.open || !terminalRef.current) {
      return;
    }

    if (props.cliStatus?.status === "ready" && connectionState === "idle") {
      connect();
      return;
    }

    if (props.cliStatus && props.cliStatus.status !== "ready" && connectionState === "idle") {
      const message = props.error ?? props.cliStatus.message;
      if (lastNotReadyMessageRef.current !== message) {
        lastNotReadyMessageRef.current = message;
        writeLine(`[${formatTerminalTime()}] ${message}`);
        writeLine("Expected setup:");
        writeLine("  cd vendor/D_RD");
        writeLine("  bun install");
        writeLine("  bun run build");
        writeLine("");
      }
    }
  }, [connect, connectionState, props.cliStatus, props.error, props.open, writeLine]);

  if (!props.open) {
    return (
      <button className={`terminal-launcher terminal-launcher-${providerStatus}`} onClick={props.onOpen}>
        <Terminal size={18} />
        <span>D_RD Terminal</span>
        <strong>{providerStatus.replace("_", " ")}</strong>
      </button>
    );
  }

  return (
    <section className="cli-terminal-dock">
      <header className="cli-terminal-header">
        <div className="cli-terminal-title">
          <div className="chat-mark">
            <Terminal size={17} />
          </div>
          <div>
            <h2>D_RD Terminal</h2>
            <p>{statusMessage}</p>
          </div>
        </div>
        <div className="cli-terminal-actions">
          <span className={`cli-status cli-status-${providerStatus}`}>{providerStatus.replace("_", " ")}</span>
          <button className="icon-button" title="Refresh terminal status" onClick={props.onRefreshStatus}>
            <RefreshCw size={16} />
          </button>
          <button className="icon-button" title="Clear terminal" onClick={() => terminalRef.current?.clear()}>
            <Trash2 size={16} />
          </button>
          {connectionState === "connected" || connectionState === "connecting" ? (
            <button className="icon-button stop-chat" title="Disconnect terminal" onClick={disconnect}>
              <Square size={15} />
            </button>
          ) : (
            <button className="primary-button compact" disabled={!canConnect} onClick={connect}>
              <Play size={15} />
              Connect
            </button>
          )}
          <button className="icon-button" title="Collapse terminal" onClick={props.onClose}>
            <ChevronDown size={16} />
          </button>
        </div>
      </header>
      {props.error ? <div className="terminal-error">{props.error}</div> : null}
      <div className="cli-terminal-body" ref={terminalHostRef} />
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
  edges: WorkflowEdge[]
): WorkflowDefinition {
  const dependencies = new Map<string, string[]>();
  const connections: WorkflowConnection[] = [];
  for (const edge of edges) {
    const currentDependencies = dependencies.get(edge.target) ?? [];
    if (!currentDependencies.includes(edge.source)) {
      dependencies.set(edge.target, [...currentDependencies, edge.source]);
    }
    connections.push(edgeToWorkflowConnection(edge));
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
    })),
    connections
  };
}

function getWorkflowDisplayConnections(workflow: WorkflowDefinition): WorkflowConnection[] {
  if (workflow.connections?.length) {
    return workflow.connections.map(normalizeWorkflowConnection);
  }

  return workflow.nodes.flatMap((node) =>
    (node.depends_on ?? []).map((dependency) =>
      normalizeWorkflowConnection({
        id: createConnectionId(dependency, undefined, node.id, undefined),
        source: dependency,
        target: node.id
      })
    )
  );
}

function applyConnectionDependencies(
  nodes: WorkflowNodeDefinition[],
  connections: WorkflowConnection[]
): WorkflowNodeDefinition[] {
  const dependencies = new Map<string, string[]>();
  for (const connection of connections) {
    const existing = dependencies.get(connection.target) ?? [];
    if (!existing.includes(connection.source)) {
      existing.push(connection.source);
    }
    dependencies.set(connection.target, existing);
  }
  return nodes.map((node) => ({ ...node, depends_on: dependencies.get(node.id) ?? [] }));
}

function getConnectionPortLabel(
  node: WorkflowNodeDefinition | undefined,
  mode: "inputs" | "outputs",
  handle: string | undefined
): string {
  const normalizedHandle = normalizeConnectionHandle(handle, mode);
  const port = node ? getNodePorts(node)[mode].find((candidate) => candidate.handle === normalizedHandle) : undefined;
  return port?.label ?? normalizedHandle ?? "main";
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
  if (type === "trigger") {
    return { ...base, name: "Manual Trigger", triggerConfig: { mode: "manual" } };
  }
  if (type === "model_selector") {
    return { ...base, name: "Model Selector", modelSelectorConfig: { provider: "mock", model: "mock-agent" } };
  }
  if (type === "tool_executor") {
    return { ...base, name: "Tool Executor", toolExecutorConfig: { toolKind: "list_input_files" } };
  }
  if (type === "document_loader") {
    return { ...base, name: "Document Loader", documentLoaderConfig: { source: "both" } };
  }
  if (type === "retriever") {
    return { ...base, name: "Retriever", retrieverConfig: { topK: 5 } };
  }
  if (type === "condition") {
    return { ...base, name: "Condition", conditionConfig: { source: "context_note", operator: "exists" } };
  }
  if (type === "merge") {
    return { ...base, name: "Merge", mergeConfig: { strategy: "concat_artifacts" } };
  }
  if (type === "filter") {
    return { ...base, name: "Filter", filterConfig: { operator: "contains", value: "" } };
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

function formatTerminalTime(): string {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
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
