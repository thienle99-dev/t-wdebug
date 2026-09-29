export interface CaptureAdapter {
  start(): Promise<void>;
  stop(): Promise<void>;
  isSupported(): boolean;
}
