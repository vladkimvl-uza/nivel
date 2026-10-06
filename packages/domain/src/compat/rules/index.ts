import type { PcRuleDef, SetupRuleDef } from "../rule-kit.ts";
import { aioRadiatorMount } from "./aio-radiator-mount.ts";
import { aioRadiatorThickness } from "./aio-radiator-thickness.ts";
import { argbHeaders } from "./argb-headers.ts";
import { armClampZone } from "./arm-clamp-zone.ts";
import { armDeskThickness } from "./arm-desk-thickness.ts";
import { armDiagonal } from "./arm-diagonal.ts";
import { armLoad } from "./arm-load.ts";
import { armVesa } from "./arm-vesa.ts";
import { chairRollback } from "./chair-rollback.ts";
import { chairUserHeight } from "./chair-user-height.ts";
import { coolerCaseHeight } from "./cooler-case-height.ts";
import { coolerSocket } from "./cooler-socket.ts";
import { coolerTdp } from "./cooler-tdp.ts";
import { cpuMbBios } from "./cpu-mb-bios.ts";
import { cpuMbChipset } from "./cpu-mb-chipset.ts";
import { cpuMbSocket } from "./cpu-mb-socket.ts";
import { cpuNoVideo } from "./cpu-no-video.ts";
import { deskDepthEyes } from "./desk-depth-eyes.ts";
import { deskWidthMonitors } from "./desk-width-monitors.ts";
import { fanHeaders } from "./fan-headers.ts";
import { gpuCaseLength } from "./gpu-case-length.ts";
import { gpuSlotWidth } from "./gpu-slot-width.ts";
import { m2Length } from "./m2-length.ts";
import { m2SataSharing } from "./m2-sata-sharing.ts";
import { m2Slots } from "./m2-slots.ts";
import { mbCaseFormfactor } from "./mb-case-formfactor.ts";
import { memCapacity } from "./mem-capacity.ts";
import { memCoolerClearance } from "./mem-cooler-clearance.ts";
import { memSlots } from "./mem-slots.ts";
import { memSpeed } from "./mem-speed.ts";
import { memType } from "./mem-type.ts";
import { psuCaseFormfactor } from "./psu-case-formfactor.ts";
import { psuCaseLength } from "./psu-case-length.ts";
import { psuGpuConnectors } from "./psu-gpu-connectors.ts";
import { psuWattage } from "./psu-wattage.ts";
import { sataPorts } from "./sata-ports.ts";
import { wifiForTask } from "./wifi-for-task.ts";

/** The 28 PC rules in the order of the frozen `RuleId` union (ARCHITECTURE 4.4). */
export const PC_RULES: readonly PcRuleDef[] = [
  cpuMbSocket,
  cpuMbChipset,
  cpuMbBios,
  cpuNoVideo,
  memType,
  memSlots,
  memCapacity,
  memSpeed,
  memCoolerClearance,
  mbCaseFormfactor,
  gpuCaseLength,
  gpuSlotWidth,
  coolerSocket,
  coolerCaseHeight,
  coolerTdp,
  aioRadiatorMount,
  aioRadiatorThickness,
  psuWattage,
  psuGpuConnectors,
  psuCaseFormfactor,
  psuCaseLength,
  m2Slots,
  m2Length,
  m2SataSharing,
  sataPorts,
  argbHeaders,
  fanHeaders,
  wifiForTask,
];

/** The 9 setup rules in the order of the frozen `RuleId` union. */
export const SETUP_RULES: readonly SetupRuleDef[] = [
  deskDepthEyes,
  deskWidthMonitors,
  armVesa,
  armLoad,
  armDiagonal,
  armDeskThickness,
  armClampZone,
  chairRollback,
  chairUserHeight,
];
