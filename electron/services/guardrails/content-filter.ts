/**
 * Content Filter Guardrail
 *
 * Kid mode content safety filtering.
 */

import { EventEmitter } from 'events';

export interface ContentFilterConfig {
  enabled: boolean;
  mode: 'kid' | 'pro';
  strictness: 'low' | 'medium' | 'high';
  customBlockedWords?: string[];
  customAllowedTopics?: string[];
  blockCodeExecution?: boolean;
  blockExternalUrls?: boolean;
  maxCodeLength?: number;
}

export interface FilterResult {
  allowed: boolean;
  filtered: boolean;
  originalContent: string;
  filteredContent?: string;
  blockedReasons: string[];
  warnings: string[];
  category?: 'profanity' | 'violence' | 'adult' | 'dangerous' | 'personal' | 'other';
}

// Word lists for content filtering
const BLOCKED_PATTERNS = {
  profanity: [
    // Basic profanity patterns (intentionally partial to avoid explicit content)
    /\bf+u+c+k/gi,
    /\bs+h+i+t/gi,
    /\ba+s+s+h+o+l+e/gi,
    /\bb+i+t+c+h/gi,
    /\bd+a+m+n/gi,
    /\bc+r+a+p/gi
  ],
  violence: [
    /\bkill\s+(yourself|them|him|her|people)/gi,
    /\bmurder/gi,
    /\btorture/gi,
    /\bsuicide/gi,
    /\bself.?harm/gi
  ],
  dangerous: [
    /\bhow\s+to\s+make\s+(a\s+)?bomb/gi,
    /\bhow\s+to\s+hack/gi,
    /\bexploit\s+vulnerability/gi,
    /\bsql\s+injection/gi,
    /\bmalware/gi,
    /\bransomware/gi
  ],
  personal: [
    /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/, // Phone numbers
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/, // Email addresses
    /\b\d{3}[-]?\d{2}[-]?\d{4}\b/, // SSN-like patterns
    /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13})\b/ // Credit card patterns
  ]
};

// Topics that are always safe in kid mode
const SAFE_TOPICS = [
  'games',
  'stories',
  'art',
  'music',
  'math',
  'science',
  'animals',
  'nature',
  'sports',
  'coding',
  'learning',
  'colors',
  'shapes',
  'numbers',
  'letters'
];

// Dangerous code patterns
const DANGEROUS_CODE_PATTERNS = [
  /eval\s*\(/gi,
  /exec\s*\(/gi,
  /system\s*\(/gi,
  /subprocess/gi,
  /os\.system/gi,
  /child_process/gi,
  /rm\s+-rf/gi,
  /del\s+\/[sfq]/gi,
  /format\s+[a-z]:/gi,
  /__import__/gi,
  /require\s*\(\s*['"]child_process/gi
];

const DEFAULT_CONFIG: ContentFilterConfig = {
  enabled: true,
  mode: 'pro',
  strictness: 'medium',
  blockCodeExecution: false,
  blockExternalUrls: false,
  maxCodeLength: 10000
};

export class ContentFilter extends EventEmitter {
  private config: ContentFilterConfig;

  constructor(config: Partial<ContentFilterConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ContentFilterConfig>): void {
    this.config = { ...this.config, ...config };
    this.emit('config:updated', this.config);
  }

  /**
   * Get current configuration
   */
  getConfig(): ContentFilterConfig {
    return { ...this.config };
  }

  /**
   * Set mode (kid/pro)
   */
  setMode(mode: 'kid' | 'pro'): void {
    this.config.mode = mode;
    this.emit('mode:changed', mode);
  }

  /**
   * Filter content
   */
  filter(content: string): FilterResult {
    const result: FilterResult = {
      allowed: true,
      filtered: false,
      originalContent: content,
      blockedReasons: [],
      warnings: []
    };

    if (!this.config.enabled) {
      return result;
    }

    // Pro mode has minimal filtering
    if (this.config.mode === 'pro' && this.config.strictness === 'low') {
      return result;
    }

    // Check for blocked patterns based on strictness
    const patternsToCheck = this.getPatternsForStrictness();

    for (const [category, patterns] of Object.entries(patternsToCheck)) {
      for (const pattern of patterns) {
        if (pattern.test(content)) {
          result.blockedReasons.push(`Content contains ${category} pattern`);
          result.category = category as FilterResult['category'];

          if (this.config.mode === 'kid') {
            result.allowed = false;
          } else {
            result.warnings.push(`Warning: ${category} content detected`);
          }
        }
      }
    }

    // Check custom blocked words
    if (this.config.customBlockedWords) {
      for (const word of this.config.customBlockedWords) {
        const regex = new RegExp(`\\b${this.escapeRegex(word)}\\b`, 'gi');
        if (regex.test(content)) {
          result.blockedReasons.push(`Content contains blocked word: ${word}`);
          if (this.config.mode === 'kid') {
            result.allowed = false;
          }
        }
      }
    }

    // Check for external URLs in kid mode
    if (this.config.mode === 'kid' && this.config.blockExternalUrls !== false) {
      const urlPattern = /https?:\/\/[^\s]+/gi;
      if (urlPattern.test(content)) {
        result.warnings.push('External URLs detected');
        // Don't block, just warn in kid mode
      }
    }

    // Check code length
    if (this.config.maxCodeLength && content.length > this.config.maxCodeLength) {
      result.warnings.push(`Content exceeds maximum length (${content.length} > ${this.config.maxCodeLength})`);
    }

    // Emit events
    if (!result.allowed) {
      this.emit('content:blocked', result);
    } else if (result.warnings.length > 0) {
      this.emit('content:warning', result);
    }

    return result;
  }

  /**
   * Filter code specifically
   */
  filterCode(code: string, language?: string): FilterResult {
    const result: FilterResult = {
      allowed: true,
      filtered: false,
      originalContent: code,
      blockedReasons: [],
      warnings: []
    };

    if (!this.config.enabled) {
      return result;
    }

    // Check for dangerous code patterns
    if (this.config.mode === 'kid' || this.config.blockCodeExecution) {
      for (const pattern of DANGEROUS_CODE_PATTERNS) {
        if (pattern.test(code)) {
          result.blockedReasons.push('Code contains potentially dangerous patterns');
          result.allowed = false;
          break;
        }
      }
    }

    // Check for shell commands in kid mode
    if (this.config.mode === 'kid' && language === 'bash') {
      const dangerousCommands = ['rm', 'del', 'format', 'curl', 'wget', 'ssh', 'sudo'];
      for (const cmd of dangerousCommands) {
        const regex = new RegExp(`\\b${cmd}\\b`, 'gi');
        if (regex.test(code)) {
          result.blockedReasons.push(`Shell command '${cmd}' not allowed in Kid mode`);
          result.allowed = false;
        }
      }
    }

    // Check code length
    if (this.config.maxCodeLength && code.length > this.config.maxCodeLength) {
      result.warnings.push(`Code exceeds maximum length`);
    }

    if (!result.allowed) {
      this.emit('code:blocked', result);
    }

    return result;
  }

  /**
   * Filter AI response for kid mode
   */
  filterResponse(response: string): FilterResult {
    const result = this.filter(response);

    // In kid mode, also check for appropriate tone
    if (this.config.mode === 'kid' && result.allowed) {
      // Check for overly complex language
      const complexWords = response.match(/\b\w{15,}\b/g);
      if (complexWords && complexWords.length > 5) {
        result.warnings.push('Response may contain overly complex language for kids');
      }

      // Check for encouragement and positive tone
      const positiveIndicators = ['great', 'awesome', 'good job', 'well done', 'nice', 'cool', 'fun'];
      const hasPositiveTone = positiveIndicators.some(word =>
        response.toLowerCase().includes(word)
      );
      if (!hasPositiveTone && response.length > 200) {
        result.warnings.push('Response may benefit from more encouraging language');
      }
    }

    return result;
  }

  /**
   * Check if a topic is safe for kid mode
   */
  isTopicSafe(topic: string): boolean {
    const lowerTopic = topic.toLowerCase();

    // Check custom allowed topics first
    if (this.config.customAllowedTopics) {
      for (const allowed of this.config.customAllowedTopics) {
        if (lowerTopic.includes(allowed.toLowerCase())) {
          return true;
        }
      }
    }

    // Check built-in safe topics
    for (const safe of SAFE_TOPICS) {
      if (lowerTopic.includes(safe)) {
        return true;
      }
    }

    // In pro mode, everything is allowed
    if (this.config.mode === 'pro') {
      return true;
    }

    // In kid mode, check against blocked patterns
    const filterResult = this.filter(topic);
    return filterResult.allowed;
  }

  /**
   * Sanitize output for kid mode (replace blocked content)
   */
  sanitize(content: string): string {
    if (!this.config.enabled || this.config.mode === 'pro') {
      return content;
    }

    let sanitized = content;

    // Replace profanity with asterisks
    for (const pattern of BLOCKED_PATTERNS.profanity) {
      sanitized = sanitized.replace(pattern, (match) => '*'.repeat(match.length));
    }

    // Remove potentially dangerous content
    for (const pattern of BLOCKED_PATTERNS.dangerous) {
      sanitized = sanitized.replace(pattern, '[content removed]');
    }

    // Mask personal information
    for (const pattern of BLOCKED_PATTERNS.personal) {
      sanitized = sanitized.replace(pattern, '[private info]');
    }

    return sanitized;
  }

  /**
   * Get patterns based on strictness level
   */
  private getPatternsForStrictness(): Record<string, RegExp[]> {
    switch (this.config.strictness) {
      case 'high':
        return BLOCKED_PATTERNS;
      case 'medium':
        return {
          profanity: BLOCKED_PATTERNS.profanity,
          violence: BLOCKED_PATTERNS.violence,
          dangerous: BLOCKED_PATTERNS.dangerous
        };
      case 'low':
        return {
          violence: BLOCKED_PATTERNS.violence,
          dangerous: BLOCKED_PATTERNS.dangerous
        };
      default:
        return BLOCKED_PATTERNS;
    }
  }

  /**
   * Escape special regex characters
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

// Singleton instance
let filterInstance: ContentFilter | null = null;

export function getContentFilter(): ContentFilter {
  if (!filterInstance) {
    filterInstance = new ContentFilter();
  }
  return filterInstance;
}

export default ContentFilter;
