import { OpenAILLM } from "@ssww.one/framework";
import { parse, ProgramNode, StatementNode, tokenize } from "@ssww.one/l4";
import { prompt } from "enquirer";
import z from 'zod';
import fs from 'fs';
import { ContinueLoop, ExitLoop, ExitProgram } from "./errors";
import axios from "axios";
import { AxiosError } from "axios";
import path from "path";

let global_context: Record<string, string> = {};
let macro_urls: Record<string, string> = {};

export interface RunProgramParam {
  source: string
  llm: OpenAILLM
  customListener?: (context: string) => Promise<string>
  level?: number
  relative_dir: string
  initial_context?: string
  semantic_model?: string
  silent?: boolean
}

export function runProgram(param: RunProgramParam): Promise<string> {
  return new Promise(async (resolve, reject) => {
    const tokens = tokenize(param.source);
    if (tokens.errors.length > 0) {
      reject(tokens.errors);
      return;
    } else {
      const parse_result = parse(tokens.tokens);
      if (parse_result.errors.length > 0) {
        reject(parse_result.errors);
        return;
      } else {
        const program = parse_result.ast;
        try {
          resolve(await execute({
            program,
            llm: param.llm,
            customListener: param.customListener,
            level: param.level,
            relative_dir: param.relative_dir,
            initial_context: param.initial_context,
            silent: param.silent
          }));
        } catch (err) {
          reject(err);
        }
      }
    }
  });
}

export interface ExecuteParam {
  program: ProgramNode
  llm: OpenAILLM
  customListener?: (context: string) => Promise<string>
  level?: number
  relative_dir: string
  initial_context?: string
  semantic_model?: string
  silent?: boolean
}

export async function execute(param: ExecuteParam) {
  if (!param.silent) printOpeningBox(param.program.title?.value ?? '<untitled>', param.level);
  for (const macro of param.program.defines) {
    macro_urls[macro.name] = macro.url;
  }
  try {
    return await executeNodes({
      nodes: param.program.body,
      old_context: param.initial_context || '',
      llm: param.llm,
      customListener: param.customListener,
      level: param.level,
      relative_dir: param.relative_dir,
      semantic_model: param.semantic_model,
      silent: param.silent
    });
  } catch (err) {
    if (err instanceof ExitProgram) {
      return 'Exit 0';
    }
    throw err;
  } finally {
    if (!param.silent) printClosingBox(param.program.title?.value ?? '<untitled>', param.level);
  }
}

export interface ExecuteNodesParam {
  nodes: StatementNode[]
  old_context: string
  llm: OpenAILLM
  customListener?: (context: string) => Promise<string>
  level?: number
  relative_dir: string
  semantic_model?: string
  silent?: boolean
}

export async function executeNodes(param: ExecuteNodesParam): Promise<string> {
  let context = param.old_context;
  for (let i = 0; i < param.nodes.length; i++) {
    const node = param.nodes[i];
    context = await executeNode({
      node: node!,
      old_context: context,
      llm: param.llm,
      customListener: param.customListener,
      level: param.level,
      relative_dir: param.relative_dir,
      semantic_model: param.semantic_model,
      silent: param.silent
    });
  }
  return context;
}

export interface ExecuteNodeParam {
  node: StatementNode
  old_context: string
  llm: OpenAILLM
  customListener?: (context: string) => Promise<string>
  level?: number,
  relative_dir: string
  semantic_model?: string
  silent?: boolean
}

export async function executeNode(param: ExecuteNodeParam): Promise<string> {
  param.llm.cleanUp();
  let output = '';
  let clean_loading: any;
  switch (param.node.type) {
    case "Read":
      if (!param.node.path) {
        throw new Error(`Path ${param.node.path} doesnt exist`);
      }
      const abs_r1_path = path.resolve(param.relative_dir, param.node.path);
      if (!fs.existsSync(abs_r1_path)) {
        throw new Error(`Path ${abs_r1_path} doesnt exist`);
      }
      output = await fs.promises.readFile(abs_r1_path, 'utf-8');
      if (param.node.debug) printDebug(`File content: ${output}`, param.level);
      break;
    case "Write":
      if (!param.node.path) {
        throw new Error(`Path is empty`);
      }
      const abs_w1_path = path.resolve(param.relative_dir, param.node.path);
      await fs.promises.writeFile(abs_w1_path, param.node.content ? replaceContext(param.node.content || '', param.old_context) : param.old_context);
      output = `Write file ${param.node.path} success`;
      break;
    case "Say":
      output = replaceContext(param.node.argument || '', param.old_context);
      if (!param.silent) printLog(output, param.level);
      break;
    case "SayThink":
      const prompt1 = [
        param.old_context,
        '',
        'User Request',
        replaceContext(param.node.argument || '', param.old_context)
      ].join('\n');
      if (param.node.debug) printDebug(`Prompt: ${prompt1}`, param.level);
      if (!param.silent) clean_loading = printLoading('Asking LLM...', param.level);
      output = (await param.llm.askLLM(prompt1, z.object({ answer: z.string() }))).answer;
      if (!param.silent) clean_loading.clean();
      if (!param.silent) printLog(output, param.level);
      break;
    case "Listen":
      if (param.customListener) {
        output = await param.customListener(param.old_context);
      } else {
        const answers: { prompt: string } = await prompt([{
          type: "input",
          name: 'prompt',
          message: ' input'
        }]);
        output = answers.prompt;
      }
      break;
    case "Think":
      const prompt2 = [
        param.old_context,
        '',
        `User Request: ${replaceContext(param.node.argument || '', param.old_context)}`,
      ].join('\n');
      if (param.node.debug) printDebug(`Prompt: ${prompt2}`, param.level);
      if (!param.silent) clean_loading = printLoading('Asking LLM...', param.level);
      output = (await param.llm.askLLM(prompt2, z.object({ answer: z.string() }))).answer;
      if (!param.silent) clean_loading?.clean();
      break;
    case "Call":
      try {
        const call_url = macro_urls[param.node.macroName] || '';
        if (param.node.debug) printDebug(`HTTP URL: ${call_url}`, param.level);
        const params = replaceContext(param.node.argument || '', param.old_context);
        if (param.node.debug) printDebug(`HTTP Params: ${params}`, param.level);
        const full_url = `${call_url}${encodeURI(params)}`;
        if (!param.silent) clean_loading = printLoading(`Fetching http request to ${full_url}...`, param.level);
        const response1 = await axios.get<string>(full_url);
        output = JSON.stringify(response1.data);
        if (param.node.debug) printDebug(`HTTP Response: ${output}`, param.level);
      } catch (err) {
        output = err instanceof AxiosError ? JSON.stringify(err.response?.data) : (err as Error).message || '';
      } finally {
        if (!param.silent) clean_loading?.clean();
      }
      break;
    case "Ask":
      const agent_name = param.node.agentName;
      const agent_path = macro_urls[agent_name];
      if (agent_path?.startsWith('http')) {
        throw new Error(`This program is currently not available for http agent`);
      }
      if (!agent_path) {
        throw new Error(`Path ${agent_path} doesnt exist`);
      }
      const abs_a1_path = path.resolve(param.relative_dir, agent_path);
      if (!fs.existsSync(abs_a1_path)) {
        throw new Error(`Path ${abs_a1_path} doesnt exist`);
      }
      const agent_code = await fs.promises.readFile(abs_a1_path, 'utf-8');
      const agent_instruction = replaceContext(param.node.argument || '', param.old_context);
      const sub_agent_level = (param.level || 0) + 1;
      output = await runProgram({
        source: agent_code,
        llm: param.llm.clone(),
        async customListener(agent_context: string) {
          const prompt_context = [
            `Your objective: ${agent_instruction}`,
            `${agent_name} gives you context:`,
            agent_context || '<no context>',
            '',
            '---',
            `Answer ${agent_name} request/statement or ask the agent to achieve your objective!`
          ].join('\n');
          if (param.node.debug) printDebug(`Agent Prompt: ${prompt_context}`, sub_agent_level);
          if (!param.silent) clean_loading = printLoading('Asking LLM...', sub_agent_level);
          const prompt_output = (await param.llm.askLLM(prompt_context, z.object({ answer: z.string() }))).answer;
          if (!param.silent) clean_loading?.clean();
          if (!param.silent) printLog(`>> ${prompt_output}`, sub_agent_level);
          return prompt_output;
        },
        level: sub_agent_level,
        relative_dir: param.relative_dir,
        silent: param.silent
      });
      break;
    case "If":
      const prompt3 = [
        'Context',
        param.old_context || '<empty context>',
        '',
        'Say answer = true if this statement true based on context above:',
        replaceContext(param.node.condition || '', param.old_context)
      ].join('\n');
      if (param.node.debug) printDebug(`Prompt: ${prompt3}`, param.level);
      if (!param.silent) clean_loading = printLoading('Asking LLM...', param.level);
      const is_satisfied = (await param.llm.askLLM(prompt3, z.object({ answer: z.boolean() }))).answer;
      if (!param.silent) clean_loading.clean();
      if (param.node.debug) printDebug(`Conditional state: ${is_satisfied}`, param.level);
      if (is_satisfied) {
        output = await executeNodes({
          nodes: param.node.body,
          old_context: param.old_context,
          llm: param.llm,
          customListener: param.customListener,
          level: param.level,
          relative_dir: param.relative_dir,
          silent: param.silent
        });
      } else {
        output = await executeNodes({
          nodes: param.node.elseBlock?.body ?? [],
          old_context: param.old_context,
          llm: param.llm,
          customListener: param.customListener,
          level: param.level,
          relative_dir: param.relative_dir,
          silent: param.silent
        });
      }
      break;
    case "Else":
      console.error('ELSE BLOCK, UNREACHABLE!');
      break;
    case "Loop":
      while (true) {
        try {
          output = await executeNodes({
            nodes: param.node.body,
            old_context: param.old_context,
            llm: param.llm,
            customListener: param.customListener,
            level: param.level,
            relative_dir: param.relative_dir,
            silent: param.silent
          });
        } catch (err) {
          if (err instanceof ExitLoop) {
            break;
          }
          if (err instanceof ContinueLoop) {
            continue;
          }
          throw err;
        }
      }
      break;
    case "Find":
      // FIND <result>/<total> <query> <source>
      const result_chunks = +param.node.resultChunks;
      const total_chunks = +param.node.totalChunks;
      if (param.node.debug) printDebug([
        `Target Chunk: ${result_chunks}`,
        `Total Chunk: ${total_chunks}`,
        `Query: ${param.node.query}`,
        `Source Context Type: ${param.node.sourceContext?.type}`,
      ].join('\n'));
      if (result_chunks >= total_chunks) {
        throw new Error(`Invalid semantic search: result chunks number should be less than ${total_chunks}.`);
      }
      let source = '';
      switch (param.node.sourceContext?.type) {
        case 'raw':
          source = param.node.sourceContext.value;
          break;
        case 'explicit':
          source = global_context[param.node.sourceContext.value] || '';
          break;
        case 'implicit':
          source = param.old_context;
          break;
      }
      
      const chunks: string[] = splitIntoNGroups(source, total_chunks);
      const vectors: number[][] = [];
      const semantic_model = param.semantic_model || 'text-embedding-3-small';
      let k = 1;
      try {
        for (const chunk of chunks) {
          if (!param.silent) clean_loading = printLoading(`Vectorizing chunk ${k}/${chunks.length}...`, param.level);
          vectors.push(await param.llm.vectorize(chunk, semantic_model));
          if (!param.silent) clean_loading.softClean();
          k++;
        }
        if (!param.silent) clean_loading = printLoading(`Vectorizing query...`, param.level);
        const query_vector = await param.llm.vectorize(param.node.query || '', semantic_model);
        if (!param.silent) clean_loading.softClean();
        if (!param.silent) clean_loading = printLoading(`Calculate most relevant vectors...`, param.level);
        const top_most_indices = topNMostRelevantIndices(vectors, query_vector, result_chunks);
        if (!param.silent) clean_loading.clean();
        if (param.node.debug) printDebug(`Top Most Indices: ${top_most_indices.join(', ')}`);
        const result = top_most_indices.map(i => `# Doc ${i + 1}\n${chunks[i]}`).join('\n\n---\n');
        if (param.node.debug) printDebug(`Result:\n${result}`);
        output = result;
      } catch (err) {} finally {
        clean_loading?.clean();
      }
      break;
    case "Paralel":
      if (!param.silent) clean_loading = printLoading(`Run ${param.node.body.length} paralel execution...`, param.level);
      const paralel_result: string[] = await Promise.all(param.node.body.map(async (child_node: StatementNode) => {
        try {
          return await executeNode({
            node: child_node,
            old_context: param.old_context,
            llm: param.llm,
            customListener: param.customListener,
            level: param.level,
            relative_dir: param.relative_dir,
            semantic_model: param.semantic_model,
            silent: true
          });
        } catch (err) {
          return err instanceof AxiosError ? JSON.stringify(err.response?.data) : (err as Error).message || '';
        }
      }));
      if (!param.silent) clean_loading?.clean();
      const concatenated_parelel_output = paralel_result.map((res, index: number) => `# Execution ${index + 1} Result\n${res}`).join('\n\n---\n');
      if (param.node.debug) printDebug(`Concatenated data:\n${concatenated_parelel_output}`);
      output = concatenated_parelel_output;
      break;
    case "ExitLoop":
      throw new ExitLoop();
    case "ContinueLoop":
      throw new ContinueLoop();
    case "Exit":
      throw new ExitProgram();
  }

  if (param.node.assignVar) global_context[param.node.assignVar] = output;
  return output;
}

export function replaceContext(text: string, old_context: string) {
  let normalized_text = text.replace(/{context}/i, old_context);
  Object.entries(global_context).forEach(([key, value]) => {
    normalized_text = normalized_text.replace(`{${key}}`, value);
  });
  return normalized_text;
}

function printDebug(text: string, level: number = 0) {
  printLog(`┎───────`, level);
  printLog(`┃ DEBUG`, level);
  printLog(`┠───────`, level);
  printLog(wrapText(text, level).split('\n').map(l => `┃ ${l}`).join('\n'), level);
  printLog(`┖───────`, level);
}

function printOpeningBox(title: string, level: number = 0) {
  const pipe_wrapper = ' ' + Array(level).fill('│ ').join('');
  console.log(`${pipe_wrapper}   ┌─${Array(title.length).fill('─').join('')}─┐`);
  console.log(`${pipe_wrapper}┌──┤ ${title} │`);
  console.log(`${pipe_wrapper}│  └─${Array(title.length).fill('─').join('')}─┘`);
}

function printClosingBox(title: string, level: number = 0) {
  const pipe_wrapper = ' ' + Array(level).fill('│ ').join('');
  console.log(`${pipe_wrapper}│  ┌─${Array(title.length).fill('─').join('')}─┐`);
  console.log(`${pipe_wrapper}└──┤ ${title} │`);
  console.log(`${pipe_wrapper}   └─${Array(title.length).fill('─').join('')}─┘`);
}

function getNormalizedText(text: string, level: number) {
  const pipe_wrapper = ' ' + Array(level + 1).fill('│ ').join('');
  return wrapText(text, level).split('\n').map(l => `${pipe_wrapper}${l}`).join('\n');
}

function printLog(text: string, level: number = 0) {
  console.log(getNormalizedText(text, level));
}

function printLoading(label: string, level: number = 0): { clean: () => void, softClean: () => void } {
  const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let frameIndex = 0;
  const pipe_wrapper = ' ' + Array(level + 1).fill('│ ').join('');

  const loaderInterval = setInterval(() => {
    // Move cursor to the start of the line and clear it
    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);

    // Print the current frame and text
    process.stdout.write(`${pipe_wrapper}${spinnerFrames[frameIndex]} ${label}`);

    // Cycle through the spinner frames
    frameIndex = (frameIndex + 1) % spinnerFrames.length;
  }, 80);

  // Stop the loader after 4 seconds
  return {
    clean() {
      clearInterval(loaderInterval);
      process.stdout.clearLine(0);
      process.stdout.cursorTo(0);
    },
    softClean() {
      clearInterval(loaderInterval);
    }
  };
}

function wrapText(text: string, level: number = 0): string {
  // Safely get columns, defaulting to 80
  const columns = (typeof process !== 'undefined' && process.stdout?.columns) ? process.stdout.columns : 80;
  const limit = columns - (2 * level + 3);

  if (limit <= 0) return text;

  return text
    .split('\n')
    .map(line => {
      // If the line already fits, return it untouched to preserve all formatting
      if (line.length <= limit) return line;

      // Split by spaces to preserve all exact spacing and naturally isolate long words
      const words = line.split(' ');
      let wrapped = '';
      let currentLine = words[0];

      for (let i = 1; i < words.length; i++) {
        const word = words[i];
        
        // If adding the next word (plus the connecting space) fits within the limit, append it
        if (currentLine!.length + 1 + word!.length <= limit) {
          currentLine += ' ' + word;
        } else {
          // Otherwise, push the current line and start a new one
          wrapped += currentLine + '\n';
          currentLine = word;
        }
      }
      
      wrapped += currentLine;
      return wrapped;
    })
    .join('\n');
}


function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function topNMostRelevantIndices(vectors: number[][], query: number[], m: number): number[] {
  return vectors
    .map((vector, index) => ({
      index,
      score: cosineSimilarity(vector, query),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, m)
    .map(({ index }) => index);
}

function splitIntoNGroups(str: string, N: number): string[] {
    const result: string[] = [];
    const baseLength = Math.floor(str.length / N);

    let offset = 0;
    for (let i = 0; i < N; i++) {
        // If it's the last group, take everything that's left
        if (i === N - 1) {
            result.push(str.slice(offset));
        } else {
            result.push(str.slice(offset, offset + baseLength));
            offset += baseLength;
        }
    }

    return result;
}
