# Swan L4 CLI

An interpreter and CLI runner for the **Swan L4 DSL**, a domain-specific language designed for building and executing LLM-driven agents, tools, and interactive workflows.

## Table of Contents

- [Overview](#overview)
- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
- [Language Features](#language-features)
- [Examples](#examples)

## Overview

Swan L4 is a structured text-based language that lets you program step-by-step logic, manage execution state, invoke LLM queries, branch conditionally, and coordinate nested agent behaviors. 

`@ssww.one/l4cli` compiles and executes these `.l4` scripts directly from your terminal.

## Installation

You can install the CLI globally from npm:

```bash
npm install -g @ssww.one/l4cli
```

### Local Development Setup

If you want to run or build the project from source:

```bash
# Install dependencies
npm install

# Build the TypeScript files and link the binary globally
npm run build
```

This registers the `l4cli` binary command globally on your system.

## Configuration

The interpreter requires access to an OpenAI-compatible API to resolve LLM calls (`THINK`, `SAY THINK`, `IF`, etc.). Define the following environment variables in a `.env` file in your execution directory or export them in your shell:

```env
OPENAI_BASEURL=https://your-llm-provider-endpoint/v1
OPENAI_APIKEY=your-api-key
OPENAI_MODEL=your-model-name

# Optional: Locale configuration ('id' or 'en'). Defaults to 'id'.
LOCALE=en
```

## Usage

Once built and configured, execute any `.l4` script using the CLI:

```bash
l4cli path/to/script.l4
```

## Language Features

The syntax, features, and tokenization/parsing specifications for the Swan L4 DSL are located in the separate repository: [swan-L4](https://github.com/riochr17/swan-L4).

## Examples

````l4
TITLE Greeting Program

SAY Welcome to the test environment!
LISTEN
THINK Extract the user's name from this text.
SAY Nice to meet you, {Context}!
````
