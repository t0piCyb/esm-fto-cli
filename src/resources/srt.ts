import { Command } from "commander";
import { client } from "../lib/client.js";
import { globalFlags } from "../lib/config.js";
import { handleError } from "../lib/errors.js";
import { readInput, writeOutput } from "../lib/io.js";
import { output } from "../lib/output.js";

export const srtResource = new Command("srt").description("SRT toolbox (runs on the server, no Drive change)");

const OPERATIONS = {
  renumber: "Renumber subtitles from 1",
  "add-line-breaks": "Wrap lines for display (Drive/Alugha convention, uses OpenAI)",
  "remove-line-breaks": "One line per subtitle (database convention)",
} as const;

for (const [operation, description] of Object.entries(OPERATIONS)) {
  srtResource
    .command(operation)
    .description(description)
    .requiredOption("-f, --file <path>", "SRT file, or - for stdin")
    .option("-o, --out <file>", "Write to a file instead of stdout")
    .addHelpText("after", `\nExample:\n  esm-fto-cli srt ${operation} -f in.srt -o out.srt`)
    .action(async (opts: { file: string; out?: string }) => {
      try {
        const content = await readInput(opts.file);
        const result = await client.post<{ content: string; subtitleCount: number }>(`/srt/${operation}`, { content });
        if (globalFlags.json) return output(result);
        writeOutput(result.content, opts.out);
      } catch (err) {
        handleError(err);
      }
    });
}
