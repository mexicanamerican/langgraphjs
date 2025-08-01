import type { Runnable, RunnableConfig } from "@langchain/core/runnables";
import type {
  All,
  PendingWrite,
  CheckpointMetadata,
  BaseCheckpointSaver,
  BaseStore,
  CheckpointListOptions,
  BaseCache,
} from "@langchain/langgraph-checkpoint";
import { Graph as DrawableGraph } from "@langchain/core/runnables/graph";
import { IterableReadableStream } from "@langchain/core/utils/stream";
import type { BaseMessage } from "@langchain/core/messages";
import type { BaseChannel } from "../channels/base.js";
import type { PregelNode } from "./read.js";
import type { Interrupt } from "../constants.js";
import { CachePolicy, RetryPolicy } from "./utils/index.js";
import { LangGraphRunnableConfig } from "./runnable_types.js";

/**
 * Selects the type of output you'll receive when streaming from the graph. See [Streaming](/langgraphjs/how-tos/#streaming) for more details.
 */
export type StreamMode =
  | "values"
  | "updates"
  | "debug"
  | "messages"
  | "checkpoints"
  | "tasks"
  | "custom";

export type Durability = "exit" | "async" | "sync";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PregelInputType = any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PregelOutputType = any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type StreamMessageOutput = [BaseMessage, Record<string, any>];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type StreamCustomOutput = any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type StreamDebugOutput = Record<string, any>;

type StreamCheckpointsOutput<StreamValues> = {
  values: StreamValues;
  next: string[];
  config: RunnableConfig;
  metadata?: CheckpointMetadata;
  parentConfig?: RunnableConfig | undefined;
  tasks: PregelTaskDescription[];
};

interface StreamTasksOutputBase {
  id: string;
  name: string;
  interrupts: Interrupt[];
}

interface StreamTasksCreateOutput<StreamValues> extends StreamTasksOutputBase {
  input: StreamValues;
  triggers: string[];
}

interface StreamTasksResultOutput<Keys, StreamUpdates>
  extends StreamTasksOutputBase {
  result: [Keys, StreamUpdates][];
}

type StreamTasksOutput<StreamUpdates, StreamValues, Nodes = string> =
  | StreamTasksCreateOutput<StreamValues>
  | StreamTasksResultOutput<Nodes, StreamUpdates>;

type DefaultStreamMode = "updates";

export type StreamOutputMap<
  TStreamMode extends StreamMode | StreamMode[] | undefined,
  TStreamSubgraphs extends boolean,
  StreamUpdates,
  StreamValues,
  Nodes
> = (
  undefined extends TStreamMode
    ? []
    : StreamMode | StreamMode[] extends TStreamMode
    ? TStreamMode extends StreamMode[]
      ? TStreamMode[number]
      : TStreamMode
    : TStreamMode extends StreamMode[]
    ? TStreamMode[number]
    : []
) extends infer Multiple extends StreamMode
  ? [TStreamSubgraphs] extends [true]
    ? {
        values: [string[], "values", StreamValues];
        updates: [
          string[],
          "updates",
          Record<Nodes extends string ? Nodes : string, StreamUpdates>
        ];
        messages: [string[], "messages", StreamMessageOutput];
        custom: [string[], "custom", StreamCustomOutput];
        checkpoints: [
          string[],
          "checkpoints",
          StreamCheckpointsOutput<StreamValues>
        ];
        tasks: [
          string[],
          "tasks",
          StreamTasksOutput<StreamUpdates, StreamValues>
        ];
        debug: [string[], "debug", StreamDebugOutput];
      }[Multiple]
    : {
        values: ["values", StreamValues];
        updates: [
          "updates",
          Record<Nodes extends string ? Nodes : string, StreamUpdates>
        ];
        messages: ["messages", StreamMessageOutput];
        custom: ["custom", StreamCustomOutput];
        checkpoints: ["checkpoints", StreamCheckpointsOutput<StreamValues>];
        tasks: ["tasks", StreamTasksOutput<StreamUpdates, StreamValues, Nodes>];
        debug: ["debug", StreamDebugOutput];
      }[Multiple]
  : (
      undefined extends TStreamMode ? DefaultStreamMode : TStreamMode
    ) extends infer Single extends StreamMode
  ? [TStreamSubgraphs] extends [true]
    ? {
        values: [string[], StreamValues];
        updates: [
          string[],
          Record<Nodes extends string ? Nodes : string, StreamUpdates>
        ];
        messages: [string[], StreamMessageOutput];
        custom: [string[], StreamCustomOutput];
        checkpoints: [string[], StreamCheckpointsOutput<StreamValues>];
        tasks: [
          string[],
          StreamTasksOutput<StreamUpdates, StreamValues, Nodes>
        ];
        debug: [string[], StreamDebugOutput];
      }[Single]
    : {
        values: StreamValues;
        updates: Record<Nodes extends string ? Nodes : string, StreamUpdates>;
        messages: StreamMessageOutput;
        custom: StreamCustomOutput;
        checkpoints: StreamCheckpointsOutput<StreamValues>;
        tasks: StreamTasksOutput<StreamUpdates, StreamValues, Nodes>;
        debug: StreamDebugOutput;
      }[Single]
  : never;

/**
 * Configuration options for executing a Pregel graph.
 * These options control how the graph executes, what data is streamed, and how interrupts are handled.
 *
 * @typeParam Nodes - Mapping of node names to their {@link PregelNode} implementations
 * @typeParam Channels - Mapping of channel names to their {@link BaseChannel} implementations
 * @typeParam ContextType - Type of context that can be passed to the graph
 */
export interface PregelOptions<
  Nodes extends StrRecord<string, PregelNode>,
  Channels extends StrRecord<string, BaseChannel>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ContextType extends Record<string, any> = Record<string, any>,
  TStreamMode extends StreamMode | StreamMode[] | undefined =
    | StreamMode
    | StreamMode[]
    | undefined,
  TSubgraphs extends boolean = boolean
> extends RunnableConfig<ContextType> {
  /**
   * Controls what information is streamed during graph execution.
   * Multiple modes can be enabled simultaneously.
   *
   * Supported modes:
   * - "values": Streams complete state after each step
   * - "updates": Streams only state changes after each step
   * - "messages": Streams messages from within nodes
   * - "custom": Streams custom events from within nodes
   * - "debug": Streams detailed execution events for tracing & debugging
   *
   * @example
   * ```typescript
   * // Stream only values
   * streamMode: "values"
   *
   * // Stream both values and debug info
   * streamMode: ["values", "debug"]
   * ```
   *
   * @default ["values"]
   */
  streamMode?: TStreamMode;

  /**
   * Specifies which channel keys to retrieve from the checkpoint when resuming execution.
   * This is an advanced option that you generally don't need to set manually.
   * The graph will automatically determine the appropriate input keys based on its configuration.
   */
  inputKeys?: keyof Channels | Array<keyof Channels>;

  /**
   * Specifies which channel keys to include in the output stream and final result.
   * Use this to filter which parts of the graph state you want to observe.
   *
   * @example
   * ```typescript
   * // Stream only the 'result' channel
   * outputKeys: "result"
   *
   * // Stream multiple channels
   * outputKeys: ["result", "intermediateState"]
   * ```
   */
  outputKeys?: keyof Channels | Array<keyof Channels>;

  /**
   * List of nodes where execution should be interrupted BEFORE the node runs.
   * Can be used for debugging and advanced state manipulation use cases. For
   * human-in-the-loop workflows, developers should prefer the
   * @link {interrupt} function instead.
   *
   * When interrupted, a resume @link {Command} must be provided to continue
   * execution.
   *
   * @example
   * ```typescript
   * // Interrupt before specific nodes
   * interruptBefore: ["humanReview", "qualityCheck"]
   *
   * // Interrupt before all nodes
   * interruptBefore: "all"
   * ```
   */
  interruptBefore?: All | Array<keyof Nodes>;

  /**
   * List of nodes where execution should be interrupted AFTER the node runs.
   * Similar to interruptBefore, but interrupts after node completion.
   * Useful when the node's output needs to be reviewed before proceeding.
   *
   * @example
   * ```typescript
   * // Interrupt after specific nodes
   * interruptAfter: ["generateContent", "analyze"]
   *
   * // Interrupt after all nodes
   * interruptAfter: "all"
   * ```
   */
  interruptAfter?: All | Array<keyof Nodes>;

  /**
   * Enables detailed debug logging during graph execution.
   * When enabled, prints information about:
   * - Task execution
   * - Channel updates
   * - Checkpoint writes
   *
   * @default false
   */
  debug?: boolean;

  /**
   * Whether to include subgraph execution details in the stream.
   * When true, state updates from nested graphs will also be streamed.
   *
   * @default false
   */
  subgraphs?: TSubgraphs;

  /**
   * Whether to checkpoint intermediate steps, defaults to `true`.
   * If `false`, only the final checkpoint is saved.
   * @deprecated Use `durability` instead.
   */
  checkpointDuring?: boolean;

  /**
   * Whether to checkpoint during the run (or only at the end/interruption).
   * - `"async"`: Save checkpoint asynchronously while the next step executes (default).
   * - `"sync"`: Save checkpoint synchronously before the next step starts.
   * - `"exit"`: Save checkpoint only when the graph exits.
   * @default "async"
   */
  durability?: Durability;

  /**
   * A shared value store that allows you to store and retrieve state across
   * threads. Useful for implementing long-term memory patterns.
   */
  store?: BaseStore;

  /**
   * Optional cache for the graph, useful for caching tasks.
   */
  cache?: BaseCache;

  /**
   * Static context for the graph run, like `userId`, `dbConnection` etc.
   */
  context?: ContextType;
}

/**
 * Construct a type with a set of properties K of type T
 */
type StrRecord<K extends string, T> = {
  [P in K]: T;
};

export interface PregelInterface<
  Nodes extends StrRecord<string, PregelNode>,
  Channels extends StrRecord<string, BaseChannel>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ContextType extends Record<string, any> = StrRecord<string, any>
> {
  lg_is_pregel: boolean;

  withConfig(config: RunnableConfig): PregelInterface<Nodes, Channels>;

  getGraphAsync(
    config: RunnableConfig & { xray?: boolean | number }
  ): Promise<DrawableGraph>;

  /** @deprecated Use getSubgraphsAsync instead. The async method will become the default in the next minor release. */
  getSubgraphs(
    namespace?: string,
    recurse?: boolean
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Generator<[string, PregelInterface<any, any>]>;

  getSubgraphsAsync(
    namespace?: string,
    recurse?: boolean
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): AsyncGenerator<[string, PregelInterface<any, any>]>;

  getState(
    config: RunnableConfig,
    options?: { subgraphs?: boolean }
  ): Promise<StateSnapshot>;

  getStateHistory(
    config: RunnableConfig,
    options?: CheckpointListOptions
  ): AsyncIterableIterator<StateSnapshot>;

  updateState(
    inputConfig: LangGraphRunnableConfig,
    values: Record<string, unknown> | unknown,
    asNode?: keyof Nodes | string
  ): Promise<RunnableConfig>;

  stream(
    input: PregelInputType,
    options?: Partial<PregelOptions<Nodes, Channels, ContextType>>
  ): Promise<IterableReadableStream<PregelOutputType>>;

  invoke(
    input: PregelInputType,
    options?: Partial<PregelOptions<Nodes, Channels, ContextType>>
  ): Promise<PregelOutputType>;
}

/**
 * Parameters for creating a Pregel graph.
 * @internal
 */
export type PregelParams<
  Nodes extends StrRecord<string, PregelNode>,
  Channels extends StrRecord<string, BaseChannel>
> = {
  /**
   * The name of the graph. @see {@link Runnable.name}
   */
  name?: string;

  /**
   * The nodes in the graph.
   */
  nodes: Nodes;

  /**
   * The channels in the graph.
   */
  channels: Channels;

  /**
   * Whether to validate the graph.
   *
   * @default true
   */
  autoValidate?: boolean;

  /**
   * The stream mode for the graph run. See [Streaming](/langgraphjs/how-tos/#streaming) for more details.
   *
   * @default ["values"]
   */
  streamMode?: StreamMode | StreamMode[];

  /**
   * The input channels for the graph run.
   */
  inputChannels: keyof Channels | Array<keyof Channels>;

  /**
   * The output channels for the graph run.
   */
  outputChannels: keyof Channels | Array<keyof Channels>;

  /**
   * After processing one of the nodes named in this list, the graph will be interrupted and a resume {@link Command} must be provided to proceed with the execution of this thread.
   * @default []
   */
  interruptAfter?: Array<keyof Nodes> | All;

  /**
   * Before processing one of the nodes named in this list, the graph will be interrupted and a resume {@link Command} must be provided to proceed with the execution of this thread.
   * @default []
   */
  interruptBefore?: Array<keyof Nodes> | All;

  /**
   * The channels to stream from the graph run.
   * @default []
   */
  streamChannels?: keyof Channels | Array<keyof Channels>;

  /**
   * @default undefined
   */
  stepTimeout?: number;

  /**
   * @default false
   */
  debug?: boolean;

  /**
   * The {@link BaseCheckpointSaver | checkpointer} to use for the graph run.
   */
  checkpointer?: BaseCheckpointSaver | boolean;

  /**
   * The default retry policy for this graph. For defaults, see {@link RetryPolicy}.
   */
  retryPolicy?: RetryPolicy;

  /**
   * The configuration for the graph run.
   */
  config?: LangGraphRunnableConfig;

  /**
   * External key-value store.
   */
  store?: BaseStore;

  /**
   * Storage used for node caching.
   */
  cache?: BaseCache;
};

export interface PregelTaskDescription {
  readonly id: string;
  readonly name: string;
  readonly error?: unknown;
  readonly interrupts: Interrupt[];
  readonly state?: LangGraphRunnableConfig | StateSnapshot;
  readonly path?: TaskPath;
  readonly result?: unknown;
}

interface CacheKey {
  ns: string[];
  key: string;
  ttl?: number;
}

export interface PregelExecutableTask<
  NodeKey extends PropertyKey,
  ChannelKey extends PropertyKey
> {
  readonly name: NodeKey;
  readonly input: unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly proc: Runnable<any, any, LangGraphRunnableConfig>;
  readonly writes: PendingWrite<ChannelKey>[];
  readonly config?: LangGraphRunnableConfig;
  readonly triggers: Array<string>;
  readonly retry_policy?: RetryPolicy;
  readonly cache_key?: CacheKey;
  readonly id: string;
  readonly path?: TaskPath;
  readonly subgraphs?: Runnable[];
  readonly writers: Runnable[];
}

export interface StateSnapshot {
  /**
   * Current values of channels
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly values: Record<string, any> | any;
  /**
   * Nodes to execute in the next step, if any
   */
  readonly next: Array<string>;
  /**
   * Config used to fetch this snapshot
   */
  readonly config: RunnableConfig;
  /**
   * Metadata about the checkpoint
   */
  readonly metadata?: CheckpointMetadata;
  /**
   * Time when the snapshot was created
   */
  readonly createdAt?: string;
  /**
   * Config used to fetch the parent snapshot, if any
   * @default undefined
   */
  readonly parentConfig?: RunnableConfig | undefined;
  /**
   * Tasks to execute in this step. If already attempted, may contain an error.
   */
  readonly tasks: PregelTaskDescription[];
}

/**
 * Options for subscribing to multiple channels.
 */
export type MultipleChannelSubscriptionOptions = {
  /**
   * Optional tags to associate with the subscription.
   */
  tags?: string[];
};

/**
 * Options for subscribing to a single channel.
 */
export type SingleChannelSubscriptionOptions = {
  /**
   * When specified, the channel mapping will be an object with this key pointing
   * to the array of channels to subscribe to. Otherwise, the channel mapping
   * will be an array of channels.
   */
  key?: string;
  /**
   * Optional tags to associate with the subscription.
   */
  tags?: string[];
};

/**
 * Options for getting the state of the graph.
 */
export type GetStateOptions = {
  /**
   * Whether to include subgraph states.
   * @default false
   */
  subgraphs?: boolean;
};

/**
 * Used for storing/retrieving internal execution state.
 *
 * @internal
 */
export type PregelScratchpad<Resume = unknown> = {
  /** Counter for tracking call invocations */
  callCounter: number;
  /** Counter for tracking interrupts */
  interruptCounter: number;
  /** List of resume values */
  resume: Resume[];
  /** Single resume value for null task ID */
  nullResume: Resume;

  consumeNullResume: () => Resume | undefined;
  /** Counter for tracking subgraph invocations */
  subgraphCounter: number;

  /** The input to the currently executing task */
  currentTaskInput: unknown;
};

/**
 * @internal
 */
export type PregelAbortSignals = {
  /** Aborts when the user calls `stream.cancel()` or aborts the {@link AbortSignal} that they passed in via the `signal` option */
  externalAbortSignal?: AbortSignal;

  /**
   * Aborts when the currently executing task throws any error other than a {@link GraphBubbleUp}
   */
  timeoutAbortSignal?: AbortSignal;

  /**
   * A reference to the AbortSignal that is passed to the node. Aborts on step timeout, stream cancel, or when an error is thrown.
   */
  composedAbortSignal?: AbortSignal;
};

export type CallOptions = {
  func: (...args: unknown[]) => unknown | Promise<unknown>;
  name: string;
  input: unknown;
  cache?: CachePolicy;
  retry?: RetryPolicy;
  callbacks?: unknown;
};

export class Call {
  func: (...args: unknown[]) => unknown | Promise<unknown>;

  name: string;

  input: unknown;

  retry?: RetryPolicy;

  cache?: CachePolicy;

  callbacks?: unknown;

  readonly __lg_type = "call";

  constructor({ func, name, input, retry, cache, callbacks }: CallOptions) {
    this.func = func;
    this.name = name;
    this.input = input;
    this.retry = retry;
    this.cache = cache;
    this.callbacks = callbacks;
  }
}

export function isCall(value: unknown): value is Call {
  return (
    typeof value === "object" &&
    value !== null &&
    "__lg_type" in value &&
    value.__lg_type === "call"
  );
}

export type SimpleTaskPath = [string, string | number];
export type VariadicTaskPath = [string, ...(string | number)[], boolean];
export type CallTaskPath =
  | [string, ...(string | number)[], Call]
  | [string, TaskPath, ...(string | number)[], Call];
export type TaskPath = SimpleTaskPath | CallTaskPath | VariadicTaskPath;
