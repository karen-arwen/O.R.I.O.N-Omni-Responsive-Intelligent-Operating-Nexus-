"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.JsonFileEventStore = exports.InMemoryEventStore = void 0;
const fs_1 = require("fs");
const path_1 = require("path");
const matchesFilter = (event, filter) => {
    if (!filter)
        return true;
    if (filter.aggregateId && event.aggregateId !== filter.aggregateId)
        return false;
    const eventTenant = event.meta.tenantId ?? "local";
    if (filter.tenantId && eventTenant !== filter.tenantId)
        return false;
    if (filter.types && filter.types.length > 0 && !filter.types.includes(event.type))
        return false;
    if (filter.since && new Date(event.timestamp) < new Date(filter.since))
        return false;
    if (filter.until && new Date(event.timestamp) > new Date(filter.until))
        return false;
    if (filter.tags && filter.tags.length > 0) {
        const tagSet = new Set(event.tags ?? []);
        const hasAll = filter.tags.every((tag) => tagSet.has(tag));
        if (!hasAll)
            return false;
    }
    if (filter.decisionId && event.meta.decisionId !== filter.decisionId)
        return false;
    if (filter.correlationId && event.meta.correlationId !== filter.correlationId)
        return false;
    return true;
};
class InMemoryEventStore {
    constructor(initialEvents) {
        this.events = initialEvents ? [...initialEvents] : [];
    }
    async append(event) {
        this.events.push(event);
    }
    async appendMany(events) {
        this.events.push(...events);
    }
    async getByAggregateId(aggregateId) {
        return this.events.filter((evt) => evt.aggregateId === aggregateId);
    }
    async query(filter) {
        const filtered = this.events.filter((evt) => matchesFilter(evt, filter));
        if (filter?.limit && filter.limit > 0) {
            return filtered.slice(0, filter.limit);
        }
        return filtered;
    }
}
exports.InMemoryEventStore = InMemoryEventStore;
class JsonFileEventStore {
    constructor(filePath) {
        this.filePath = filePath;
        this.events = [];
        this.loaded = false;
        this.queue = Promise.resolve();
    }
    async ensureLoaded() {
        if (this.loaded)
            return;
        try {
            const file = await fs_1.promises.readFile(this.filePath, "utf-8");
            this.events = JSON.parse(file);
        }
        catch (error) {
            const err = error;
            if (err.code !== "ENOENT") {
                throw error;
            }
            this.events = [];
        }
        this.loaded = true;
    }
    enqueue(operation) {
        this.queue = this.queue.then(() => operation());
        return this.queue;
    }
    async persist() {
        const directory = (0, path_1.join)(this.filePath, "..");
        await fs_1.promises.mkdir(directory, { recursive: true });
        await fs_1.promises.writeFile(this.filePath, JSON.stringify(this.events, null, 2), "utf-8");
    }
    async append(event) {
        await this.enqueue(async () => {
            await this.ensureLoaded();
            this.events.push(event);
            await this.persist();
        });
    }
    async appendMany(events) {
        await this.enqueue(async () => {
            await this.ensureLoaded();
            this.events.push(...events);
            await this.persist();
        });
    }
    async getByAggregateId(aggregateId) {
        await this.ensureLoaded();
        return this.events.filter((evt) => evt.aggregateId === aggregateId);
    }
    async query(filter) {
        await this.ensureLoaded();
        const filtered = this.events.filter((evt) => matchesFilter(evt, filter));
        if (filter?.limit && filter.limit > 0) {
            return filtered.slice(0, filter.limit);
        }
        return filtered;
    }
}
exports.JsonFileEventStore = JsonFileEventStore;
