import { promises as fs } from "fs";
import { join } from "path";
import { DomainEvent, EventFilter } from "../../shared/src";
export type { EventFilter } from "../../shared/src";

export interface EventStore {
  append(event: DomainEvent): Promise<void>;
  appendMany(events: DomainEvent[]): Promise<void>;
  getByAggregateId(aggregateId: string): Promise<DomainEvent[]>;
  query(filter?: EventFilter): Promise<DomainEvent[]>;
}

const matchesFilter = (event: DomainEvent, filter?: EventFilter): boolean => {
  if (!filter) return true;
  if (filter.aggregateId && event.aggregateId !== filter.aggregateId) return false;
  const eventTenant = event.meta.tenantId ?? "local";
  if (filter.tenantId && eventTenant !== filter.tenantId) return false;
  if (filter.types && filter.types.length > 0 && !filter.types.includes(event.type)) return false;
  if (filter.since && new Date(event.timestamp) < new Date(filter.since)) return false;
  if (filter.until && new Date(event.timestamp) > new Date(filter.until)) return false;
  if (filter.tags && filter.tags.length > 0) {
    const tagSet = new Set(event.tags ?? []);
    const hasAll = filter.tags.every((tag) => tagSet.has(tag));
    if (!hasAll) return false;
  }
  if (filter.decisionId && event.meta.decisionId !== filter.decisionId) return false;
  if (filter.correlationId && event.meta.correlationId !== filter.correlationId) return false;
  return true;
};

export class InMemoryEventStore implements EventStore {
  private events: DomainEvent[];

  constructor(initialEvents?: DomainEvent[]) {
    this.events = initialEvents ? [...initialEvents] : [];
  }

  async append(event: DomainEvent): Promise<void> {
    this.events.push(event);
  }

  async appendMany(events: DomainEvent[]): Promise<void> {
    this.events.push(...events);
  }

  async getByAggregateId(aggregateId: string): Promise<DomainEvent[]> {
    return this.events.filter((evt) => evt.aggregateId === aggregateId);
  }

  async query(filter?: EventFilter): Promise<DomainEvent[]> {
    const filtered = this.events.filter((evt) => matchesFilter(evt, filter));
    if (filter?.limit && filter.limit > 0) {
      return filtered.slice(0, filter.limit);
    }
    return filtered;
  }
}

export class JsonFileEventStore implements EventStore {
  private events: DomainEvent[] = [];
  private loaded = false;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    try {
      const file = await fs.readFile(this.filePath, "utf-8");
      this.events = JSON.parse(file) as DomainEvent[];
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== "ENOENT") {
        throw error;
      }
      this.events = [];
    }
    this.loaded = true;
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(() => operation());
    return this.queue;
  }

  private async persist(): Promise<void> {
    const directory = join(this.filePath, "..");
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(this.events, null, 2), "utf-8");
  }

  async append(event: DomainEvent): Promise<void> {
    await this.enqueue(async () => {
      await this.ensureLoaded();
      this.events.push(event);
      await this.persist();
    });
  }

  async appendMany(events: DomainEvent[]): Promise<void> {
    await this.enqueue(async () => {
      await this.ensureLoaded();
      this.events.push(...events);
      await this.persist();
    });
  }

  async getByAggregateId(aggregateId: string): Promise<DomainEvent[]> {
    await this.ensureLoaded();
    return this.events.filter((evt) => evt.aggregateId === aggregateId);
  }

  async query(filter?: EventFilter): Promise<DomainEvent[]> {
    await this.ensureLoaded();
    const filtered = this.events.filter((evt) => matchesFilter(evt, filter));
    if (filter?.limit && filter.limit > 0) {
      return filtered.slice(0, filter.limit);
    }
    return filtered;
  }
}
