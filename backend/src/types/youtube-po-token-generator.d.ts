declare module 'youtube-po-token-generator' {
  interface GenerateResult {
    visitorData: string;
    poToken: string;
  }

  export function generate(): Promise<GenerateResult>;
}

declare module 'youtube-po-token-generator/lib/task' {
  interface Task {
    start(): Promise<{ poToken: string }>;
  }

  export function createTask(visitorData: string): Promise<Task>;
}
