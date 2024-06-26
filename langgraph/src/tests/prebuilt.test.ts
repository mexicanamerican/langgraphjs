/* eslint-disable no-process-env */
import { it, expect, beforeAll, describe } from "@jest/globals";
import { PromptTemplate } from "@langchain/core/prompts";
import { FakeStreamingLLM } from "@langchain/core/utils/testing";
import { Tool } from "@langchain/core/tools";
import { createAgentExecutor } from "../prebuilt/index.js";

// Tracing slows down the tests
beforeAll(() => {
  process.env.LANGCHAIN_TRACING_V2 = "false";
  process.env.LANGCHAIN_ENDPOINT = "";
  process.env.LANGCHAIN_ENDPOINT = "";
  process.env.LANGCHAIN_API_KEY = "";
  process.env.LANGCHAIN_PROJECT = "";
});

describe("PreBuilt", () => {
  class SearchAPI extends Tool {
    name = "search_api";

    description = "A simple API that returns the input string.";

    constructor() {
      super();
    }

    async _call(query: string): Promise<string> {
      return `result for ${query}`;
    }
  }
  const tools = [new SearchAPI()];

  it("Can invoke createAgentExecutor", async () => {
    const prompt = PromptTemplate.fromTemplate("Hello!");

    const llm = new FakeStreamingLLM({
      responses: [
        "tool:search_api:query",
        "tool:search_api:another",
        "finish:answer",
      ],
    });

    const agentParser = (input: string) => {
      if (input.startsWith("finish")) {
        const answer = input.split(":")[1];
        return {
          returnValues: { answer },
          log: input,
        };
      }
      const [, toolName, toolInput] = input.split(":");
      return {
        tool: toolName,
        toolInput,
        log: input,
      };
    };

    const agent = prompt.pipe(llm).pipe(agentParser);

    const agentExecutor = createAgentExecutor({
      agentRunnable: agent,
      tools,
    });

    const result = await agentExecutor.invoke({
      input: "what is the weather in sf?",
    });

    expect(result).toEqual({
      input: "what is the weather in sf?",
      agentOutcome: {
        returnValues: {
          answer: "answer",
        },
        log: "finish:answer",
      },
      steps: [
        {
          action: {
            tool: "search_api",
            toolInput: "query",
            log: "tool:search_api:query",
          },
          observation: "result for query",
        },
        {
          action: {
            tool: "search_api",
            toolInput: "another",
            log: "tool:search_api:another",
          },
          observation: "result for another",
        },
      ],
    });
  });

  it("Can stream createAgentExecutor", async () => {
    const prompt = PromptTemplate.fromTemplate("Hello!");

    const llm = new FakeStreamingLLM({
      responses: [
        "tool:search_api:query",
        "tool:search_api:another",
        "finish:answer",
      ],
    });

    const agentParser = (input: string) => {
      if (input.startsWith("finish")) {
        const answer = input.split(":")[1];
        return {
          returnValues: { answer },
          log: input,
        };
      }
      const [, toolName, toolInput] = input.split(":");
      return {
        tool: toolName,
        toolInput,
        log: input,
      };
    };

    const agent = prompt.pipe(llm).pipe(agentParser);

    const agentExecutor = createAgentExecutor({
      agentRunnable: agent,
      tools,
    });

    const stream = agentExecutor.stream({
      input: "what is the weather in sf?",
    });
    const fullResponse = [];
    for await (const item of await stream) {
      fullResponse.push(item);
    }

    expect(fullResponse.length > 3).toBe(true);

    const allAgentMessages = fullResponse.filter((res) => "agent" in res);
    expect(allAgentMessages.length >= 3).toBe(true);

    expect(fullResponse).toEqual([
      {
        agent: {
          agentOutcome: {
            log: "tool:search_api:query",
            tool: "search_api",
            toolInput: "query",
          },
        },
      },
      {
        action: {
          steps: [
            {
              action: {
                log: "tool:search_api:query",
                tool: "search_api",
                toolInput: "query",
              },
              observation: "result for query",
            },
          ],
        },
      },
      {
        agent: {
          agentOutcome: {
            log: "tool:search_api:another",
            tool: "search_api",
            toolInput: "another",
          },
        },
      },
      {
        action: {
          steps: [
            {
              action: {
                log: "tool:search_api:another",
                tool: "search_api",
                toolInput: "another",
              },
              observation: "result for another",
            },
          ],
        },
      },
      {
        agent: {
          agentOutcome: {
            log: "finish:answer",
            returnValues: {
              answer: "answer",
            },
          },
        },
      },
    ]);
  });
});
