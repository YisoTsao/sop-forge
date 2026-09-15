import type { RawEvent, Step } from "../../domain/src/index.js";

export function validateRecordingUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Please enter a valid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Recording only supports HTTP or HTTPS URLs.");
  }
  return url.toString();
}

export function deduplicateRawEvents(events: RawEvent[]): RawEvent[] {
  const unique = new Map<string, RawEvent>();
  for (const event of [...events].sort(
    (left, right) => left.sequence - right.sequence,
  )) {
    if (!unique.has(event.id)) unique.set(event.id, event);
  }
  return [...unique.values()];
}

function targetForEvent(event: RawEvent) {
  if (
    event.type === "click" ||
    event.type === "input" ||
    event.type === "select" ||
    event.type === "keypress"
  ) {
    return event.target;
  }
  return undefined;
}

function titleForEvent(event: RawEvent): string {
  switch (event.type) {
    case "navigation":
      return "Navigate to page";
    case "click":
      return event.target?.accessibleName
        ? `Click "${event.target.accessibleName}"`
        : "Click here.";
    case "input":
      return event.input.name ? `Enter ${event.input.name}` : "Enter text";
    case "select":
      return event.select.name
        ? `Select ${event.select.name}`
        : "Select an option";
    case "keypress":
      return `Press ${event.key}`;
    case "unsupported":
      return "Unsupported action";
  }
}

function descriptionForEvent(event: RawEvent): string {
  switch (event.type) {
    case "navigation":
      return event.navigation.url;
    case "click":
      return event.target?.visibleText ?? "";
    case "input":
      return event.input.value;
    case "select":
      return event.select.value;
    case "keypress":
      return event.key;
    case "unsupported":
      return event.detail;
  }
}

export function normalizeRawEvents(
  events: RawEvent[],
  screenshotAssets: Map<string, string>,
): Step[] {
  const steps: Step[] = [];
  for (const event of deduplicateRawEvents(events)) {
    const previous = steps.at(-1);
    if (
      event.type === "navigation" &&
      previous?.action === "navigation" &&
      (previous.description === event.navigation.url ||
        (previous.screenshotAssetId !== undefined &&
          previous.screenshotAssetId === screenshotAssets.get(event.id)))
    ) {
      continue;
    }
    if (
      event.type === "input" &&
      previous?.action === "input" &&
      previous.sourceEventIds.length > 0
    ) {
      const previousEventId = previous.sourceEventIds.at(-1);
      const previousEvent = events.find(
        (candidate) => candidate.id === previousEventId,
      );
      if (
        previousEvent?.type === "input" &&
        previousEvent.input.name === event.input.name &&
        previousEvent.input.inputType === event.input.inputType
      ) {
        previous.description = event.input.value;
        previous.sourceEventIds.push(event.id);
        continue;
      }
    }

    const step: Step = {
      id: `step-${event.id}`,
      order: steps.length,
      action: event.type === "unsupported" ? "unsupported" : event.type,
      title: titleForEvent(event),
      description: descriptionForEvent(event),
      sourceEventIds: [event.id],
      target: targetForEvent(event),
      screenshotAssetId: screenshotAssets.get(event.id),
    };
    steps.push(step);
  }

  return steps;
}
