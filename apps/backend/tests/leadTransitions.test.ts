import { describe, expect, it } from "vitest";
import { isValidLeadTransition } from "../src/modules/leads/leadTransitions";

describe("isValidLeadTransition", () => {
  it("allows the expected forward pipeline", () => {
    expect(isValidLeadTransition("NEW", "QUALIFIED")).toBe(true);
    expect(isValidLeadTransition("QUALIFIED", "ASSIGNED")).toBe(true);
    expect(isValidLeadTransition("ASSIGNED", "CONTACTED")).toBe(true);
    expect(isValidLeadTransition("CONTACTED", "VISIT_SCHEDULED")).toBe(true);
    expect(isValidLeadTransition("VISIT_SCHEDULED", "VISITED")).toBe(true);
    expect(isValidLeadTransition("VISITED", "APPLICATION_STARTED")).toBe(true);
    expect(isValidLeadTransition("APPLICATION_STARTED", "APPROVED")).toBe(true);
    expect(isValidLeadTransition("APPROVED", "DISBURSED")).toBe(true);
  });

  it("rejects skipping stages", () => {
    expect(isValidLeadTransition("NEW", "VISITED")).toBe(false);
    expect(isValidLeadTransition("NEW", "APPROVED")).toBe(false);
    expect(isValidLeadTransition("ASSIGNED", "DISBURSED")).toBe(false);
  });

  it("rejects moving backward", () => {
    expect(isValidLeadTransition("VISITED", "CONTACTED")).toBe(false);
    expect(isValidLeadTransition("APPROVED", "NEW")).toBe(false);
  });

  it("treats DISBURSED and REJECTED as terminal", () => {
    expect(isValidLeadTransition("DISBURSED", "APPROVED")).toBe(false);
    expect(isValidLeadTransition("DISBURSED", "FOLLOW_UP")).toBe(false);
    expect(isValidLeadTransition("REJECTED", "NEW")).toBe(false);
  });

  it("allows FOLLOW_UP as a detour back into the pipeline", () => {
    expect(isValidLeadTransition("CONTACTED", "FOLLOW_UP")).toBe(true);
    expect(isValidLeadTransition("FOLLOW_UP", "VISIT_SCHEDULED")).toBe(true);
    expect(isValidLeadTransition("FOLLOW_UP", "CONTACTED")).toBe(true);
  });

  it("allows rejection/not-interested from most active stages", () => {
    expect(isValidLeadTransition("NEW", "REJECTED")).toBe(true);
    expect(isValidLeadTransition("VISITED", "NOT_INTERESTED")).toBe(true);
  });

  it("rejects a status transitioning to itself", () => {
    expect(isValidLeadTransition("CONTACTED", "CONTACTED")).toBe(false);
  });
});
