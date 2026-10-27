/**
 * M7 TOFU (Trust-On-First-Use) Pinning v1.0
 * 
 * Защита памяти от prompt injection через memory poisoning.
 * При первом сохранении записи фиксируется "отпечаток" (pin).
 * Последующие обновления проверяются на соответствие.
 * 
 * Источник идеи: Trail of Bits (MCP security research)
 * 
 * @version 1.0.0
 * @since M7 v3.10.4
 */

import crypto from 'crypto';
import path from 'path';
import fs from 'fs/promises';
import { createLogger } from '../utils/logger.js';
import { getProjectPath } from '../utils/projectPath.js';
import { atomicWriteJSON, safeReadJSON } from '../utils/atomicWrite.js';

const log = createLogger('[TOFU]');

// ============================================================================
// Types
// ============================================================================

/**
 * Pin — отпечаток доверенной записи
 */
export interface TrustPin {
  /** ID записи */
  recordId: string;
  /** SHA-256 хэш первого контента */
  contentHash: string;
  /** Источник записи */
  source: string;
  /** Кто создал */
  createdBy: 'system' | 'user' | 'extension' | 'hive';
  /** Timestamp создания */
  pinnedAt: number;
  /** Был ли pin подтверждён пользователем */
  userVerified: boolean;
  /** Счётчик обновлений */
  updateCount: number;
  /** Последний проверенный хэш */
  lastVerifiedHash: string;
}

/**
 * Результат проверки
 */
export interface TrustCheckResult {
  /** Доверена ли запись */
  trusted: boolean;
  /** Причина (если не доверена) */
  reason?: string;
  /** Уровень риска */
  risk: 'none' | 'low' | 'medium' | 'high' | 'critical';
  /** Рекомендация */
  recommendation?: string;
  /** Pin (если есть) */
  pin?: TrustPin;
}

/**
 * Suspicious pattern
 */
interface SuspiciousPattern {
  name: string;
  pattern: RegExp;
  risk: 'medium' | 'high' | 'critical';
  description: string;
}

// ============================================================================
// Suspicious Patterns (prompt injection detection)
// ============================================================================

const SUSPICIOUS_PATTERNS: SuspiciousPattern[] = [
  {
    name: 'instruction_override',
    pattern: /ignore\s+(all\s+)?previous\s+(instructions|prompts|rules)/i,
    risk: 'critical',
    description: 'Attempt to override system instructions'
  },
  {
    name: 'role_injection',
    pattern: /you\s+are\s+(now|actually)\s+a/i,
    risk: 'critical',
    description: 'Attempt to change AI role'
  },
  {
    name: 'system_prompt_leak',
    pattern: /repeat\s+(your\s+)?system\s+prompt|show\s+your\s+instructions/i,
    risk: 'high',
    description: 'Attempt to extract system prompt'
  },
  {
    name: 'hidden_instruction',
    pattern: /\[SYSTEM\]|\[INST\]|<\|im_start\|>|<\|system\|>/i,
    risk: 'high',
    description: 'Hidden instruction markers'
  },
  {
    name: 'base64_payload',
    pattern: /eval\s*\(atob\s*\(|Buffer\.from\s*\(['"]/,
    risk: 'high',
    description: 'Encoded payload execution'
  },
  {
    name: 'data_exfil',
    pattern: /send\s+(all\s+)?(data|files|secrets|keys|tokens)\s+to/i,
    risk: 'critical',
    description: 'Data exfiltration attempt'
  },
  {
    name: 'permission_escalation',
    pattern: /sudo|admin\s+access|bypass\s+(auth|security|validation)/i,
    risk: 'medium',
    description: 'Permission escalation language'
  }
];

// ============================================================================
// TOFU Manager
// ============================================================================

export class TOFUManager {
  private pins = new Map<string, TrustPin>();
  private projectPath: string;
  private loaded = false;
  
  constructor(projectPath?: string) {
    this.projectPath = projectPath || getProjectPath();
  }
  
  /**
   * Загрузить pins из файла
   */
  async load(): Promise<void> {
    if (this.loaded) return;
    
    const filePath = this.getPinsPath();
    try {
      const result = await safeReadJSON<Record<string, TrustPin>>(filePath);
      if (result.data) {
        for (const [id, pin] of Object.entries(result.data)) {
          this.pins.set(id, pin);
        }
        log.info(`Loaded ${this.pins.size} trust pins`);
      }
    } catch {
      // No pins file — ok
    }
    
    this.loaded = true;
  }
  
  /**
   * Сохранить pins
   */
  async save(): Promise<void> {
    const filePath = this.getPinsPath();
    const data: Record<string, TrustPin> = {};
    
    for (const [id, pin] of this.pins) {
      data[id] = pin;
    }
    
    await atomicWriteJSON(filePath, data);
  }
  
  /**
   * Зафиксировать pin для записи (Trust-On-First-Use)
   */
  async pin(
    recordId: string,
    content: string,
    source: string,
    createdBy: TrustPin['createdBy'] = 'system'
  ): Promise<TrustPin> {
    await this.load();
    
    const hash = this.computeHash(content);
    
    const pin: TrustPin = {
      recordId,
      contentHash: hash,
      source,
      createdBy,
      pinnedAt: Date.now(),
      userVerified: false,
      updateCount: 0,
      lastVerifiedHash: hash
    };
    
    this.pins.set(recordId, pin);
    await this.save();
    
    log.debug(`Pin created for ${recordId} (source: ${source})`);
    return pin;
  }
  
  /**
   * Проверить запись на доверие
   */
  async check(recordId: string, content: string): Promise<TrustCheckResult> {
    await this.load();
    
    // 1. Проверяем подозрительные паттерны
    const suspiciousCheck = this.scanForSuspicious(content);
    if (suspiciousCheck) {
      return suspiciousCheck;
    }
    
    // 2. Проверяем pin
    const pin = this.pins.get(recordId);
    
    if (!pin) {
      // Первое использование — доверяем
      return {
        trusted: true,
        risk: 'low',
        recommendation: 'First use — consider pinning',
        pin: undefined
      };
    }
    
    // 3. Проверяем хэш
    const currentHash = this.computeHash(content);
    
    if (currentHash === pin.lastVerifiedHash) {
      return {
        trusted: true,
        risk: 'none',
        pin
      };
    }
    
    // 4. Контент изменился — проверяем насколько
    if (pin.userVerified) {
      // Пользователь подтверждал — средний риск
      return {
        trusted: false,
        reason: 'Content changed since user-verified pin',
        risk: 'medium',
        recommendation: 'Review changes and re-verify',
        pin
      };
    }
    
    // Системный pin — низкий риск при малом числе обновлений
    if (pin.updateCount < 5) {
      return {
        trusted: true,
        risk: 'low',
        recommendation: 'Pin updated automatically',
        pin
      };
    }
    
    return {
      trusted: false,
      reason: 'Too many unverified updates',
      risk: 'medium',
      recommendation: 'Verify record content',
      pin
    };
  }
  
  /**
   * Обновить pin после проверки
   */
  async updatePin(recordId: string, newContent: string): Promise<TrustPin | null> {
    await this.load();
    
    const pin = this.pins.get(recordId);
    if (!pin) return null;
    
    pin.lastVerifiedHash = this.computeHash(newContent);
    pin.updateCount++;
    
    this.pins.set(recordId, pin);
    await this.save();
    
    return pin;
  }
  
  /**
   * Подтвердить pin пользователем
   */
  async verifyPin(recordId: string): Promise<boolean> {
    await this.load();
    
    const pin = this.pins.get(recordId);
    if (!pin) return false;
    
    pin.userVerified = true;
    this.pins.set(recordId, pin);
    await this.save();
    
    log.info(`Pin user-verified: ${recordId}`);
    return true;
  }
  
  /**
   * Удалить pin
   */
  async unpin(recordId: string): Promise<boolean> {
    await this.load();
    
    if (!this.pins.has(recordId)) return false;
    
    this.pins.delete(recordId);
    await this.save();
    
    return true;
  }
  
  /**
   * Пакетная проверка записей
   */
  async batchCheck(
    records: Array<{ id: string; content: string }>
  ): Promise<Map<string, TrustCheckResult>> {
    await this.load();
    
    const results = new Map<string, TrustCheckResult>();
    
    for (const record of records) {
      results.set(record.id, await this.check(record.id, record.content));
    }
    
    return results;
  }
  
  /**
   * Получить все pins
   */
  getPins(): TrustPin[] {
    return Array.from(this.pins.values());
  }
  
  /**
   * Получить статистику
   */
  getStats(): {
    totalPins: number;
    userVerified: number;
    systemPins: number;
    avgUpdates: number;
  } {
    const pins = Array.from(this.pins.values());
    return {
      totalPins: pins.length,
      userVerified: pins.filter(p => p.userVerified).length,
      systemPins: pins.filter(p => p.createdBy === 'system').length,
      avgUpdates: pins.length > 0
        ? Math.round(pins.reduce((s, p) => s + p.updateCount, 0) / pins.length)
        : 0
    };
  }
  
  // ============================================================================
  // Private
  // ============================================================================
  
  /**
   * Сканировать контент на подозрительные паттерны
   */
  private scanForSuspicious(content: string): TrustCheckResult | null {
    for (const pattern of SUSPICIOUS_PATTERNS) {
      if (pattern.pattern.test(content)) {
        log.warn(`Suspicious pattern detected: ${pattern.name}`);
        return {
          trusted: false,
          reason: `Suspicious pattern: ${pattern.description}`,
          risk: pattern.risk,
          recommendation: 'Review content manually before trusting'
        };
      }
    }
    return null;
  }
  
  private computeHash(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
  }
  
  private getPinsPath(): string {
    return path.join(this.projectPath, '.m7', 'trust-pins.json');
  }
}

// ============================================================================
// Singleton
// ============================================================================

let tofuManager: TOFUManager | null = null;

export function getTOFUManager(projectPath?: string): TOFUManager {
  if (!tofuManager) {
    tofuManager = new TOFUManager(projectPath);
  }
  return tofuManager;
}

export function resetTOFUManager(): void {
  tofuManager = null;
}

// ============================================================================
// Convenience: scan content for injection
// ============================================================================

export function scanForInjection(content: string): {
  safe: boolean;
  threats: Array<{ name: string; risk: string; description: string }>;
} {
  const threats: Array<{ name: string; risk: string; description: string }> = [];
  
  for (const pattern of SUSPICIOUS_PATTERNS) {
    if (pattern.pattern.test(content)) {
      threats.push({
        name: pattern.name,
        risk: pattern.risk,
        description: pattern.description
      });
    }
  }
  
  return {
    safe: threats.length === 0,
    threats
  };
}
