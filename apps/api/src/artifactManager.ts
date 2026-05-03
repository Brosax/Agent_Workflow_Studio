import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentArtifactOutput, Artifact, ArtifactWithContent, NodeRun } from "@agent-studio/shared";
import { artifactRoot } from "./config";
import { StudioDatabase } from "./db";

export class ArtifactManager {
  constructor(private readonly db: StudioDatabase) {}

  async saveArtifact(args: {
    runId: string;
    nodeRun: NodeRun;
    output: AgentArtifactOutput;
  }): Promise<Artifact> {
    const version = this.db.nextArtifactVersion(args.runId, args.output.name);
    const runDir = path.join(artifactRoot, args.runId);
    await mkdir(runDir, { recursive: true });

    const safeName = sanitizeArtifactName(args.output.name);
    const diskName = `${String(version).padStart(2, "0")}-${safeName}`;
    const contentPath = path.join(runDir, diskName);
    await writeFile(contentPath, contentForDisk(args.output), "utf8");

    return this.db.createArtifact({
      id: crypto.randomUUID(),
      workflowRunId: args.runId,
      nodeRunId: args.nodeRun.id,
      nodeId: args.nodeRun.nodeId,
      name: args.output.name,
      type: args.output.type,
      version,
      contentPath,
      createdBy: args.nodeRun.nodeId
    });
  }

  async readArtifact(artifact: Artifact): Promise<ArtifactWithContent> {
    const content = await readFile(artifact.contentPath, "utf8");
    return { ...artifact, content };
  }

  async readArtifacts(artifacts: Artifact[]): Promise<ArtifactWithContent[]> {
    return Promise.all(artifacts.map((artifact) => this.readArtifact(artifact)));
  }
}

function sanitizeArtifactName(name: string): string {
  return name.replace(/[^a-z0-9_.-]+/gi, "_");
}

function contentForDisk(output: AgentArtifactOutput): string {
  if (output.type === "html") {
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(output.name)}</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 860px; margin: 40px auto; line-height: 1.55; color: #111827; }
    pre { white-space: pre-wrap; background: #f3f4f6; padding: 18px; border-radius: 8px; }
  </style>
</head>
<body>
  <pre>${escapeHtml(output.content)}</pre>
</body>
</html>`;
  }

  if (output.type === "pdf") {
    return buildMinimalPdf(output.content);
  }

  return output.content;
}

function buildMinimalPdf(content: string): string {
  const text = content
    .replace(/[()\\]/g, "\\$&")
    .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, "")
    .split(/\r?\n/)
    .slice(0, 34);
  const lines = text.length ? text : ["Generated PDF artifact"];
  const streamLines = ["BT", "/F1 11 Tf", "50 770 Td"];
  lines.forEach((line, index) => {
    streamLines.push(index === 0 ? `(${line.slice(0, 92)}) Tj` : `0 -18 Td (${line.slice(0, 92)}) Tj`);
  });
  streamLines.push("ET");
  const stream = streamLines.join("\n");
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
    `5 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(pdf.length);
    pdf += object;
  }
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return pdf;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
