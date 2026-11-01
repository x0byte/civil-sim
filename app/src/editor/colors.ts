import type { SpaceType } from "../../../contracts/floorplan.ts";

export const SPACE_COLORS: Record<SpaceType, string> = {
  open_office: "#7fb3e6",
  private_office: "#b49ce0",
  meeting_room: "#f2b766",
  toilet: "#72cfc2",
  pantry: "#f09a8a",
  reception: "#a9d07a",
  corridor: "#c9ced6",
  storage: "#b8a99a",
  shop: "#e6a3c8",
  food_court: "#f5c98a",
  atrium: "#dfe3e8",
  service: "#a7adb5",
  other: "#d6d9de",
};
