import { Command } from "commander";
import pc from "picocolors";
import { client, seg } from "../lib/client.js";
import { globalFlags } from "../lib/config.js";
import { CliError, handleError } from "../lib/errors.js";
import { readInput, writeOutput } from "../lib/io.js";
import { output } from "../lib/output.js";

/**
 * Generic access to the FTO app's tool registry (`GET /api/v1/tools`).
 * Every tool declared in the app is usable here as soon as it is deployed,
 * before (or without) a dedicated command: `tools run <name> key=value`.
 */

type JsonSchema = {
  type?: string | string[];
  description?: string;
  default?: unknown;
  enum?: unknown[];
  anyOf?: JsonSchema[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
};

type Tool = {
  name: string;
  title: string;
  description: string;
  category: string;
  access: "read" | "write";
  destructive: boolean;
  openWorld: boolean;
  roles: string[] | null;
  route: string | null;
  inputSchema: JsonSchema;
};

const getTool = async (name: string) => (await client.get<{ tool: Tool }>(`/tools/${seg(name)}`)).tool;

const typeOf = (schema: JsonSchema): string => {
  if (schema.enum) return schema.enum.join("|");
  if (schema.anyOf) return schema.anyOf.map(typeOf).join(" or ");
  return [schema.type ?? "any"].flat().join("|");
};

const acceptsOnlyStrings = (schema: JsonSchema | undefined): boolean => {
  if (!schema) return false;
  if (schema.anyOf) return schema.anyOf.every((s) => acceptsOnlyStrings(s) || s.type === "null");
  return schema.type === "string" || (Array.isArray(schema.enum) && schema.enum.every((v) => typeof v === "string"));
};

/**
 * `key=value` → input field. Values are read as JSON (numbers, booleans,
 * null, objects) unless the schema says the field is a string, so
 * `ref=q1.c2.s3` and `year=2026` stay text where the tool expects text.
 */
export const parseAssignments = (pairs: string[], schema: JsonSchema): Record<string, unknown> => {
  const input: Record<string, unknown> = {};
  for (const pair of pairs) {
    const index = pair.indexOf("=");
    if (index <= 0) throw new CliError(2, `Expected key=value, got "${pair}"`);
    const key = pair.slice(0, index);
    const raw = pair.slice(index + 1);
    if (acceptsOnlyStrings(schema.properties?.[key])) {
      input[key] = raw;
      continue;
    }
    try {
      input[key] = JSON.parse(raw);
    } catch {
      input[key] = raw;
    }
  }
  return input;
};

export const toolsResource = new Command("tools").description(
  "Every FTO tool (same as the MCP tools): list, describe, run any of them by name",
);

toolsResource
  .command("list")
  .description("Tools your role can use")
  .option("--category <name>", "Only one category (videos, subtitles, jobs, voice, alugha, sync, users...)")
  .option("--access <read|write>", "Only read or write tools")
  .action(async (opts: { category?: string; access?: string }) => {
    try {
      const { data } = await client.get<{ data: Tool[] }>("/tools");
      const tools = data.filter(
        (tool) => (!opts.category || tool.category === opts.category) && (!opts.access || tool.access === opts.access),
      );
      if (globalFlags.json) return output(tools);
      output(
        tools.map((tool) => ({
          name: tool.name,
          access: tool.access + (tool.destructive ? "!" : ""),
          category: tool.category,
          route: tool.route ?? "",
          title: tool.title,
        })),
      );
      console.log(pc.dim('write! = overwrites or publishes. Details: esm-fto-cli tools describe <name>'));
    } catch (err) {
      handleError(err);
    }
  });

toolsResource
  .command("describe")
  .description("What a tool does and its inputs")
  .argument("<name>", "Tool name, e.g. list_videos")
  .action(async (name: string) => {
    try {
      const tool = await getTool(name);
      if (globalFlags.json) return output(tool);
      const flags = [
        tool.access,
        tool.destructive && "overwrites/deletes",
        tool.openWorld && "acts on Alugha",
        tool.roles && `roles: ${tool.roles.join(", ")}`,
      ].filter(Boolean);
      console.log(`${pc.bold(tool.name)}  ${pc.dim(flags.join(" · "))}`);
      if (tool.route) console.log(pc.dim(tool.route));
      console.log(`\n${tool.description}\n`);
      const required = new Set(tool.inputSchema.required ?? []);
      const fields = Object.entries(tool.inputSchema.properties ?? {}).map(([key, schema]) => ({
        input: required.has(key) ? key : `${key}?`,
        type: typeOf(schema),
        default: schema.default === undefined ? "" : JSON.stringify(schema.default),
        description: schema.description ?? "",
      }));
      if (fields.length) output(fields);
      console.log(pc.dim(`\nRun: esm-fto-cli tools run ${tool.name} ${fields.map((f) => `${f.input.replace("?", "")}=...`).join(" ")}`));
    } catch (err) {
      handleError(err);
    }
  });

toolsResource
  .command("run")
  .description("Run a tool by name")
  .argument("<name>", "Tool name, e.g. get_video")
  .argument("[inputs...]", "Inputs as key=value (JSON values: limit=5, force=true)")
  .option("-i, --input <json>", "Whole input as JSON, @file.json, or - for stdin")
  .option("--file <key=path...>", "Read a field from a file, e.g. --file content=fr.srt")
  .option("--raw <field>", "Print one text field of the result as is (e.g. content), or -o to save it")
  .option("-o, --out <file>", "With --raw, write the field to a file")
  .addHelpText(
    "after",
    `
Examples:
  esm-fto-cli tools run list_videos language=fr languageStatus=PENDING limit=5
  esm-fto-cli tools run get_subtitles ref=q1.c2.s3 lang=fr --raw content -o fr.srt
  esm-fto-cli tools run save_subtitles ref=q1.c2.s3 lang=fr --file content=fr.srt
  esm-fto-cli tools run update_video -i '{"ref":"q1.c2.s3","archived":true}'`,
  )
  .action(async (name: string, inputs: string[], opts: { input?: string; file?: string[]; raw?: string; out?: string }) => {
    try {
      const tool = await getTool(name);

      let input: Record<string, unknown> = {};
      if (opts.input) {
        const text = opts.input === "-" || opts.input.startsWith("@") ? await readInput(opts.input.replace(/^@/, "")) : opts.input;
        try {
          input = JSON.parse(text) as Record<string, unknown>;
        } catch {
          throw new CliError(2, "--input is not valid JSON");
        }
      }
      Object.assign(input, parseAssignments(inputs, tool.inputSchema));
      for (const pair of opts.file ?? []) {
        const [key, path] = pair.split(/=(.*)/s);
        if (!key || !path) throw new CliError(2, `Expected --file key=path, got "${pair}"`);
        input[key] = await readInput(path);
      }

      const result = await client.post<Record<string, unknown>>(`/tools/${seg(name)}`, input);

      if (opts.raw) {
        const value = result[opts.raw];
        if (typeof value !== "string") throw new CliError(2, `The result has no text field "${opts.raw}"`);
        return writeOutput(value, opts.out);
      }
      output(result);
    } catch (err) {
      handleError(err);
    }
  });
