import type { RuleId } from "./types.ts";

export const MESSAGE_KEY_PREFIX = "compat.";

export interface MessageKeySpec {
  /** Rule that raises the key; "*" for keys shared by all rules. */
  rule: RuleId | "*";
  /** Names of `CompatIssue.params` the key always carries (the placeholders of the translation). */
  params: readonly string[];
}

/**
 * Every `messageKey` the rules can return, with the params that go with it. Texts are not here: `packages/i18n`
 * (namespace `common`, WP-08) owns them; the Russian drafts are in packages/testing/fixtures/wp-03/compat-message-keys.json.
 * A test keeps this table, the rules and that file in step.
 */
export const COMPAT_MESSAGE_KEYS: Readonly<Record<string, MessageKeySpec>> = {
  "compat.missing_data": { rule: "*", params: ["field", "category"] },
  "compat.socket_mismatch": { rule: "CPU_MB_SOCKET", params: ["cpuSocket", "boardSocket"] },
  "compat.chipset_unsupported": { rule: "CPU_MB_CHIPSET", params: ["chipset", "supported"] },
  "compat.bios_update_flashback": { rule: "CPU_MB_BIOS", params: ["chipset", "minBios", "shippedBios"] },
  "compat.bios_update_seller": { rule: "CPU_MB_BIOS", params: ["chipset", "minBios", "shippedBios"] },
  "compat.no_video_output": { rule: "CPU_NO_VIDEO", params: [] },
  "compat.mem_type_board": { rule: "MEM_TYPE", params: ["ramType", "boardType"] },
  "compat.mem_type_cpu": { rule: "MEM_TYPE", params: ["ramType", "cpuTypes"] },
  "compat.mem_slots_exceeded": { rule: "MEM_SLOTS", params: ["modules", "slots"] },
  "compat.mem_capacity_exceeded": { rule: "MEM_CAPACITY", params: ["totalGb", "maxGb"] },
  "compat.mem_speed_reduced": { rule: "MEM_SPEED", params: ["ramMts", "effectiveMts"] },
  "compat.mem_cooler_clearance": { rule: "MEM_COOLER_CLEARANCE", params: ["ramMm", "clearanceMm"] },
  "compat.board_not_supported": { rule: "MB_CASE_FORMFACTOR", params: ["board", "supported"] },
  "compat.gpu_too_long": { rule: "GPU_CASE_LENGTH", params: ["gpuMm", "caseMm"] },
  "compat.gpu_tight_fit": { rule: "GPU_CASE_LENGTH", params: ["gpuMm", "caseMm", "marginMm"] },
  "compat.gpu_slots_exceeded": { rule: "GPU_SLOT_WIDTH", params: ["gpuSlots", "caseSlots"] },
  "compat.cooler_socket_unsupported": { rule: "COOLER_SOCKET", params: ["cpuSocket", "cooler"] },
  "compat.cooler_too_tall": { rule: "COOLER_CASE_HEIGHT", params: ["coolerMm", "caseMm"] },
  "compat.cooler_tight_fit": { rule: "COOLER_CASE_HEIGHT", params: ["coolerMm", "caseMm", "marginMm"] },
  "compat.cooler_underpowered": { rule: "COOLER_TDP", params: ["coolerW", "cpuW"] },
  "compat.aio_no_mount": { rule: "AIO_RADIATOR_MOUNT", params: ["radMm"] },
  "compat.aio_too_thick": { rule: "AIO_RADIATOR_THICKNESS", params: ["thicknessMm", "maxMm"] },
  "compat.psu_below_peak": { rule: "PSU_WATTAGE", params: ["psuW", "peakW"] },
  "compat.psu_below_recommended": { rule: "PSU_WATTAGE", params: ["psuW", "recommendedW", "peakW"] },
  "compat.psu_low_headroom": { rule: "PSU_WATTAGE", params: ["headroomPct", "minPct", "peakW"] },
  "compat.psu_8pin_missing": { rule: "PSU_GPU_CONNECTORS", params: ["need", "have"] },
  "compat.psu_12v2x6_missing": { rule: "PSU_GPU_CONNECTORS", params: ["need", "have"] },
  "compat.psu_12v2x6_adapter": { rule: "PSU_GPU_CONNECTORS", params: ["need", "have"] },
  "compat.psu_form_factor_unsupported": { rule: "PSU_CASE_FORMFACTOR", params: ["psuFF", "supported"] },
  "compat.psu_too_long": { rule: "PSU_CASE_LENGTH", params: ["psuMm", "caseMm"] },
  "compat.m2_slots_exceeded": { rule: "M2_SLOTS", params: ["nvme", "slots"] },
  "compat.m2_too_long": { rule: "M2_LENGTH", params: ["ssdMm", "slotMm"] },
  "compat.m2_disables_sata": { rule: "M2_SATA_SHARING", params: ["sataDrives", "usablePorts"] },
  "compat.sata_ports_exceeded": { rule: "SATA_PORTS", params: ["sata", "ports"] },
  "compat.argb_headers_short": { rule: "ARGB_HEADERS", params: ["need", "have"] },
  "compat.rgb_headers_short": { rule: "ARGB_HEADERS", params: ["need", "have"] },
  "compat.fan_mounts_exceeded": { rule: "FAN_HEADERS", params: ["need", "have"] },
  "compat.fan_headers_short": { rule: "FAN_HEADERS", params: ["need", "have"] },
  "compat.no_wireless": { rule: "WIFI_FOR_TASK", params: ["task"] },
  "compat.monitors_wider_than_desk": { rule: "DESK_WIDTH_MONITORS", params: ["monitorsMm", "deskMm"] },
  "compat.eye_distance_short": { rule: "DESK_DEPTH_EYES", params: ["eyeMm", "minMm"] },
  "compat.eye_distance_long": { rule: "DESK_DEPTH_EYES", params: ["eyeMm", "maxMm"] },
  "compat.arm_vesa_unsupported": { rule: "ARM_VESA", params: ["monitorVesa", "armVesa"] },
  "compat.arm_monitor_no_vesa": { rule: "ARM_VESA", params: [] },
  "compat.arm_overload": { rule: "ARM_LOAD", params: ["weightKg", "maxKg"] },
  "compat.arm_underload": { rule: "ARM_LOAD", params: ["weightKg", "minKg"] },
  "compat.arm_diagonal_out_of_range": { rule: "ARM_DIAGONAL", params: ["diagIn", "minIn", "maxIn"] },
  "compat.arm_desk_thickness": { rule: "ARM_DESK_THICKNESS", params: ["deskMm", "minMm", "maxMm"] },
  "compat.arm_clamp_over_leg": { rule: "ARM_CLAMP_ZONE", params: ["xMm", "fromMm", "toMm"] },
  "compat.chair_rollback_short": { rule: "CHAIR_ROLLBACK", params: ["freeMm", "needMm"] },
  "compat.chair_user_height": { rule: "CHAIR_USER_HEIGHT", params: ["userCm", "minCm", "maxCm"] },
};
