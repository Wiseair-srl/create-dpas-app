import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  DeviceSchema,
  type Device,
  type DeviceListFilter,
} from "@/features/devices/schemas/device";
import { seedDevices } from "./seed";

/**
 * Zero-configuration embedded store (ADR-0004): devices live in memory and are
 * written through to `.data/db.json` so mutations survive restarts. The oRPC
 * procedures are the only callers — swap this file for a real database without
 * touching either capability plane.
 */

const FileShape = z.object({ devices: z.array(DeviceSchema) });

export interface DeviceStore {
  list(filter?: DeviceListFilter): Device[];
  get(id: string): Device | undefined;
  disable(ids: string[], meta: { by: string; reason?: string }): Device[];
  enable(ids: string[], meta: { by: string }): Device[];
  reset(): void;
}

function dataFile(): string {
  // DPAS_DATA_DIR lets tests and CI isolate the store from the project tree.
  return path.join(process.env.DPAS_DATA_DIR ?? path.join(process.cwd(), ".data"), "db.json");
}

function atomicWrite(file: string, contents: string) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, contents, "utf8");
  renameSync(tmp, file);
}

function createStore(): DeviceStore {
  let devices: Map<string, Device>;

  const persist = () => {
    atomicWrite(
      dataFile(),
      JSON.stringify({ devices: Array.from(devices.values()) }, null, 2),
    );
  };

  const load = (): Map<string, Device> => {
    const file = dataFile();
    if (existsSync(file)) {
      try {
        const parsed = FileShape.parse(JSON.parse(readFileSync(file, "utf8")));
        return new Map(parsed.devices.map((d) => [d.id, d]));
      } catch {
        // Corrupt or outdated file: fall through to a fresh seed.
      }
    }
    const seeded = new Map(seedDevices().map((d) => [d.id, d]));
    devices = seeded;
    persist();
    return seeded;
  };

  devices = load();

  return {
    list(filter) {
      let result = Array.from(devices.values());
      if (filter?.status) result = result.filter((d) => d.status === filter.status);
      if (filter?.disabled !== undefined) {
        result = result.filter((d) => d.disabled === filter.disabled);
      }
      if (filter?.city) {
        const city = filter.city.toLowerCase();
        result = result.filter((d) => d.city.toLowerCase() === city);
      }
      return result;
    },
    get(id) {
      return devices.get(id);
    },
    disable(ids, _meta) {
      const updated: Device[] = [];
      for (const id of ids) {
        const device = devices.get(id);
        if (!device) continue;
        const next = { ...device, disabled: true };
        devices.set(id, next);
        updated.push(next);
      }
      persist();
      return updated;
    },
    enable(ids, _meta) {
      const updated: Device[] = [];
      for (const id of ids) {
        const device = devices.get(id);
        if (!device) continue;
        const next = { ...device, disabled: false };
        devices.set(id, next);
        updated.push(next);
      }
      persist();
      return updated;
    },
    reset() {
      devices = new Map(seedDevices().map((d) => [d.id, d]));
      persist();
    },
  };
}

// One store per server process, survives HMR via globalThis.
const globalKey = "__dpasDeviceStore" as const;
export function getDeviceStore(): DeviceStore {
  const g = globalThis as Record<string, unknown>;
  if (!g[globalKey]) g[globalKey] = createStore();
  return g[globalKey] as DeviceStore;
}
