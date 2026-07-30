import {
  disableDevices,
  enableDevices,
  getDevice,
  listDevices,
  resetDevices,
} from "./procedures";

/**
 * The application router: served over HTTP at /api/orpc for the dashboard UI
 * and the contextual agent path, and wrapped by the orpc-agent capability
 * registry for direct model tools. One router, every consumer.
 */
export const router = {
  devices: {
    list: listDevices,
    get: getDevice,
    disable: disableDevices,
    enable: enableDevices,
    reset: resetDevices,
  },
};

export type AppRouter = typeof router;
