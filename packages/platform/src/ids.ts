import { v7 } from 'uuid';

export const newId = (): string => v7();

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export const CLOCK = 'STOCKROOM_CLOCK';
