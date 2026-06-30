#!/usr/bin/env node

import dotenv from 'dotenv';
dotenv.config({ quiet: true, debug: false });

import path from 'path';
import { setLocale } from "@ssww.one/l4";
import { runProgram } from "./executor";
import { OpenAILLM } from "@ssww.one/framework";
import { readFileSync } from "node:fs";

const file_input_path = process.argv[2];
if (!file_input_path) {
  console.error("Please provide .l4 file input");
  process.exit(0);
}

const abs_path = path.resolve(file_input_path);
const source = readFileSync(abs_path, 'utf-8');

const relative_dir = path.dirname(abs_path);

setLocale(process.env.LOCALE as ('en' | 'id') || 'id');
const llm = new OpenAILLM({
  base_url: process.env.OPENAI_BASEURL || '',
  apiKey: process.env.OPENAI_APIKEY || '',
  model: process.env.OPENAI_MODEL || '',
});
runProgram({ source, llm, relative_dir }).then(s => console.log(`Output: ${s}`)).catch(console.error);
