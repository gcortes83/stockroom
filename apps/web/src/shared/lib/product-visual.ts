import {
  BookOpen,
  Box,
  ChefHat,
  Coffee,
  Cpu,
  Dumbbell,
  Footprints,
  Gamepad2,
  Gift,
  HeartPulse,
  Lamp,
  type LucideIcon,
  Package,
  PawPrint,
  PenTool,
  Shirt,
  Sparkles,
  Tent,
  Watch,
  Wrench,
} from 'lucide-react';

const ICONS: Record<string, LucideIcon> = {
  electronics: Cpu,
  footwear: Footprints,
  sports: Dumbbell,
  kitchen: ChefHat,
  books: BookOpen,
  beauty: Sparkles,
  outdoors: Tent,
  'home-and-office': Lamp,
  accessories: Watch,
  clothing: Shirt,
  'food-and-beverage': Coffee,
  games: Gamepad2,
  stationery: PenTool,
  gifts: Gift,
  pets: PawPrint,
  health: HeartPulse,
  tools: Wrench,
  misc: Package,
};

export const categoryIcon = (slug: string): LucideIcon => ICONS[slug] ?? Box;

export function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function productGradient(seed: string): string {
  const hash = hashString(seed);
  const hue = hash % 360;
  const second = (hue + 40 + (hash % 80)) % 360;
  const third = (hue + 180 + (hash % 50)) % 360;
  const x = 20 + (hash % 60);
  const y = 15 + ((hash >> 8) % 60);
  return [
    `radial-gradient(circle at ${x}% ${y}%, hsl(${hue} 90% 68% / 0.95), transparent 55%)`,
    `radial-gradient(circle at ${100 - x}% ${100 - y}%, hsl(${second} 85% 60% / 0.85), transparent 60%)`,
    `radial-gradient(circle at 50% 120%, hsl(${third} 80% 55% / 0.7), transparent 60%)`,
    `linear-gradient(135deg, hsl(${hue} 45% 18%), hsl(${second} 50% 12%))`,
  ].join(', ');
}
