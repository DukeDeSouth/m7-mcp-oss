import { createLogger } from '../../utils/logger.js';
const log = createLogger('[typescriptChecker]');
/**
 * M7 Quality Gate - TypeScript Checker
 * 
 * Использует TypeScript Compiler API для проверки типов
 */

import * as ts from 'typescript';
import {
  QualityIssue,
  ICodeChecker,
  IssueSeverity,
  IssueCategory,
  TS_SYNTAX_CODES,
  TS_LOGIC_CODES,
} from '../types.js';

export class TypeScriptChecker implements ICodeChecker {
  name = 'TypeScript';
  available = true;
  
  constructor() {
    // TypeScript всегда доступен (уже в зависимостях проекта)
  }
  
  async check(code: string, filePath: string): Promise<QualityIssue[]> {
    try {
      const compilerOptions: ts.CompilerOptions = {
        noEmit: true,
        strict: false,
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        esModuleInterop: true,
        skipLibCheck: true,
        skipDefaultLibCheck: true,
        noImplicitAny: false,
        strictNullChecks: false,
        // Не указываем lib - TypeScript использует default для target
      };
      
      const host = this.createCompilerHost(filePath, code, compilerOptions);
      const program = ts.createProgram([filePath], compilerOptions, host);
      
      const diagnostics = ts.getPreEmitDiagnostics(program);
      
      // Фильтруем системные ошибки и ложные срабатывания
      const filteredDiagnostics = diagnostics.filter(diag => {
        const msg = ts.flattenDiagnosticMessageText(diag.messageText, '');
        
        // Игнорируем ошибки связанные с lib файлами
        const libRelatedCodes = [
          2318, // Cannot find global type
          2307, // Cannot find module (внешние модули)
          2584, // Cannot find name 'console'
          2552, // Cannot find name - may exist in lib
        ];
        
        if (libRelatedCodes.includes(diag.code)) {
          // Игнорируем глобальные типы и стандартные объекты
          if (msg.includes('global type') || 
              msg.includes("'Array'") || 
              msg.includes("'Object'") ||
              msg.includes("'String'") ||
              msg.includes("'Number'") ||
              msg.includes("'Boolean'") ||
              msg.includes("'Promise'") ||
              msg.includes("'console'") ||
              msg.includes("'Error'")) {
            return false;
          }
        }
        
        // Игнорируем redeclare для известных глобальных имён в изолированном контексте
        if (diag.code === 2451) { // Cannot redeclare block-scoped variable
          const globalNames = ['name', 'status', 'length', 'self', 'top', 'parent', 'location', 'history'];
          for (const globalName of globalNames) {
            if (msg.includes(`'${globalName}'`)) {
              return false; // Это конфликт с глобальным именем, не реальная ошибка
            }
          }
        }
        
        // Игнорируем "Property does not exist on type 'void'" когда это связано с предыдущей ошибкой
        if (diag.code === 2339 && msg.includes("type 'void'")) {
          return false; // Cascade error от другой проблемы
        }
        
        return true;
      });
      
      return filteredDiagnostics.map(diag => this.convertDiagnostic(diag, filePath));
    } catch (error) {
      log.debug('TypeScriptChecker] Error:', error);
      return [{
        id: 'ts_checker_error',
        source: 'typescript',
        severity: 'error',
        category: 'unknown',
        file: filePath,
        line: 1,
        column: 1,
        code: 'TS_CHECKER_ERROR',
        message: `TypeScript checker failed: ${error instanceof Error ? error.message : String(error)}`,
        fixable: false,
      }];
    }
  }
  
  private convertDiagnostic(diag: ts.Diagnostic, defaultFilePath: string): QualityIssue {
    let line = 1;
    let column = 1;
    let file = defaultFilePath;
    
    if (diag.file && diag.start !== undefined) {
      const pos = ts.getLineAndCharacterOfPosition(diag.file, diag.start);
      line = pos.line + 1;
      column = pos.character + 1;
      file = diag.file.fileName;
    }
    
    const code = `TS${diag.code}`;
    const message = ts.flattenDiagnosticMessageText(diag.messageText, '\n');
    
    return {
      id: `ts_${diag.code}_${line}_${column}`,
      source: 'typescript',
      severity: this.mapSeverity(diag.category),
      category: this.classifyCode(diag.code),
      file,
      line,
      column,
      code,
      message,
      fixable: this.isFixable(diag.code),
      // TypeScript API не предоставляет auto-fix, но мы можем генерировать простые
      fix: this.generateFix(diag),
    };
  }
  
  private classifyCode(code: number): IssueCategory {
    if (TS_SYNTAX_CODES.includes(code)) {
      return 'syntax';
    }
    
    if (TS_LOGIC_CODES.includes(code)) {
      return 'logic';
    }
    
    // Default: если это ошибка типов, скорее всего logic
    if (code >= 2300 && code < 2800) {
      return 'logic';
    }
    
    return 'unknown';
  }
  
  private isFixable(code: number): boolean {
    // Только некоторые syntax ошибки можно автоматически исправить
    return TS_SYNTAX_CODES.includes(code);
  }
  
  private mapSeverity(category: ts.DiagnosticCategory): IssueSeverity {
    switch (category) {
      case ts.DiagnosticCategory.Error:
        return 'error';
      case ts.DiagnosticCategory.Warning:
        return 'warning';
      case ts.DiagnosticCategory.Suggestion:
      case ts.DiagnosticCategory.Message:
      default:
        return 'info';
    }
  }
  
  private generateFix(diag: ts.Diagnostic): { range: [number, number]; text: string } | undefined {
    // Генерируем простые auto-fix для некоторых ошибок
    // В будущем можно расширить
    
    if (!diag.start || !diag.file) return undefined;
    
    switch (diag.code) {
      case 1005: // Expected token (например, ';')
        // Добавить ожидаемый токен
        return {
          range: [diag.start, diag.start],
          text: ';',
        };
      
      case 1002: // Unterminated string
        // Добавить закрывающую кавычку
        const text = diag.file.text;
        const char = text[diag.start];
        if (char === '"' || char === "'" || char === '`') {
          return {
            range: [diag.start + diag.length!, diag.start + diag.length!],
            text: char,
          };
        }
        return undefined;
      
      default:
        return undefined;
    }
  }
  
  private createCompilerHost(
    filePath: string,
    code: string,
    _options: ts.CompilerOptions
  ): ts.CompilerHost {
    const sourceFile = ts.createSourceFile(
      filePath,
      code,
      ts.ScriptTarget.Latest,
      true,
      this.getScriptKind(filePath)
    );
    
    // Используем стандартный host для доступа к lib файлам
    const defaultHost = ts.createCompilerHost(_options);
    
    return {
      ...defaultHost,
      getSourceFile: (name: string, languageVersion: ts.ScriptTarget) => {
        if (name === filePath) {
          return sourceFile;
        }
        // Для lib файлов используем стандартный host
        return defaultHost.getSourceFile(name, languageVersion);
      },
      fileExists: (f: string) => {
        if (f === filePath) return true;
        return defaultHost.fileExists(f);
      },
      readFile: (f: string) => {
        if (f === filePath) return code;
        return defaultHost.readFile(f);
      },
    };
  }
  
  private getScriptKind(filePath: string): ts.ScriptKind {
    if (filePath.endsWith('.tsx')) return ts.ScriptKind.TSX;
    if (filePath.endsWith('.ts')) return ts.ScriptKind.TS;
    if (filePath.endsWith('.jsx')) return ts.ScriptKind.JSX;
    if (filePath.endsWith('.js')) return ts.ScriptKind.JS;
    return ts.ScriptKind.TS; // default
  }
}
