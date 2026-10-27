/**
 * Type Scanner
 * Scans TypeScript files and extracts type information
 * v8.1: Lazy load ts-morph (~60 MB) — only loaded when scan() is called
 */

import * as fs from 'fs/promises';
import * as path from 'path';
// NOTE: ts-morph is NOT imported at top level — loaded dynamically in scan()
// import type is erased at compile time, zero runtime cost
import type { Project as TsProject, TypeFormatFlags as TsTypeFormatFlags } from 'ts-morph';
import {
  TypeScanData,
  InterfaceInfo,
  TypeAliasInfo,
  EnumInfo,
  ClassInfo,
  FieldInfo,
  EnumMember,
  MethodInfo,
  PropertyInfo,
  ParameterInfo,
  ScanResult
} from '../types.js';
import { listFilesRecursive } from '../utils/fileUtils.js';

// Module-level lazy cache for ts-morph
let _tsMorph: typeof import('ts-morph') | null = null;

async function getTsMorph(): Promise<typeof import('ts-morph')> {
  if (!_tsMorph) {
    _tsMorph = await import('ts-morph');
  }
  return _tsMorph;
}

export class TypeScanner {
  private project: TsProject | null = null;
  private tsMorphModule: typeof import('ts-morph') | null = null;
  
  constructor(private projectPath: string) {
    // v8.1: ts-morph Project created lazily in ensureProject()
  }

  /**
   * Lazily create ts-morph Project (loads ~60 MB on first call)
   */
  private async ensureProject(): Promise<TsProject> {
    if (!this.project) {
      this.tsMorphModule = await getTsMorph();
      this.project = new this.tsMorphModule.Project({
        tsConfigFilePath: path.join(this.projectPath, 'tsconfig.json'),
        skipAddingFilesFromTsConfig: true
      });
    }
    return this.project;
  }
  
  /**
   * Scan all TypeScript files in src/
   */
  async scan(): Promise<ScanResult<TypeScanData>> {
    const startTime = Date.now();
    
    try {
      const project = await this.ensureProject();
      
      // Find all .ts files in src/
      const srcPath = path.join(this.projectPath, 'src');
      const tsFiles = await listFilesRecursive(srcPath, (file) => 
        file.endsWith('.ts') && !file.endsWith('.d.ts')
      );
      
      // Add files to project
      for (const file of tsFiles) {
        project.addSourceFileAtPath(file);
      }
      
      // Extract type information
      const interfaces: InterfaceInfo[] = [];
      const types: TypeAliasInfo[] = [];
      const enums: EnumInfo[] = [];
      const classes: ClassInfo[] = [];
      
      for (const sourceFile of project.getSourceFiles()) {
        const filePath = sourceFile.getFilePath();
        
        // Extract interfaces
        for (const interfaceDecl of sourceFile.getInterfaces()) {
          const info = this.extractInterfaceInfo(interfaceDecl, filePath);
          if (info) interfaces.push(info);
        }
        
        // Extract type aliases
        for (const typeAlias of sourceFile.getTypeAliases()) {
          const info = this.extractTypeAliasInfo(typeAlias, filePath);
          if (info) types.push(info);
        }
        
        // Extract enums
        for (const enumDecl of sourceFile.getEnums()) {
          const info = this.extractEnumInfo(enumDecl, filePath);
          if (info) enums.push(info);
        }
        
        // Extract classes
        for (const classDecl of sourceFile.getClasses()) {
          const info = this.extractClassInfo(classDecl, filePath);
          if (info) classes.push(info);
        }
      }
      
      const scanTime = Date.now() - startTime;
      
      return {
        success: true,
        data: {
          interfaces,
          types,
          enums,
          classes
        },
        timestamp: new Date(),
        scan_time_ms: scanTime
      };
    } catch (error: any) {
      return {
        success: false,
        data: {
          interfaces: [],
          types: [],
          enums: [],
          classes: []
        },
        timestamp: new Date(),
        scan_time_ms: Date.now() - startTime,
        errors: [error.message]
      };
    }
  }
  
  /**
   * Extract interface information
   */
  private extractInterfaceInfo(node: any, filePath: string): InterfaceInfo | null {
    try {
      const name = node.getName();
      const exported = node.isExported();
      
      // Get JSDoc description
      const jsDocs = node.getJsDocs();
      const description = jsDocs.length > 0 
        ? jsDocs[0].getDescription().trim()
        : undefined;
      
      // Get fields
      const fields: FieldInfo[] = [];
      for (const prop of node.getProperties()) {
        const field = this.extractFieldInfo(prop);
        if (field) fields.push(field);
      }
      
      // Get extends
      const extendsTypes = node.getExtends();
      const extendsNames = extendsTypes.map((ext: any) => ext.getText());
      
      return {
        name,
        file: this.getRelativePath(filePath),
        exported,
        fields,
        extends: extendsNames.length > 0 ? extendsNames : undefined,
        description
      };
    } catch (error) {
      return null;
    }
  }
  
  /**
   * Extract field information from property
   */
  private extractFieldInfo(prop: any): FieldInfo | null {
    try {
      const name = prop.getName();
      const optional = prop.hasQuestionToken();
      
      // Get type
      let type = 'unknown';
      try {
        const typeNode = prop.getTypeNode();
        if (typeNode) {
          type = typeNode.getText();
        } else {
          const propType = prop.getType();
          type = propType.getText(undefined, this.tsMorphModule!.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope);
        }
      } catch {
        // Fallback to 'unknown'
      }
      
      // Get JSDoc description
      const jsDocs = prop.getJsDocs();
      const description = jsDocs.length > 0
        ? jsDocs[0].getDescription().trim()
        : undefined;
      
      return {
        name,
        type,
        optional,
        description
      };
    } catch (error) {
      return null;
    }
  }
  
  /**
   * Extract type alias information
   */
  private extractTypeAliasInfo(node: any, filePath: string): TypeAliasInfo | null {
    try {
      const name = node.getName();
      const exported = node.isExported();
      
      // Get type
      const typeNode = node.getTypeNode();
      const type = typeNode ? typeNode.getText() : 'unknown';
      
      // Get JSDoc description
      const jsDocs = node.getJsDocs();
      const description = jsDocs.length > 0
        ? jsDocs[0].getDescription().trim()
        : undefined;
      
      return {
        name,
        file: this.getRelativePath(filePath),
        exported,
        type,
        description
      };
    } catch (error) {
      return null;
    }
  }
  
  /**
   * Extract enum information
   */
  private extractEnumInfo(node: any, filePath: string): EnumInfo | null {
    try {
      const name = node.getName();
      const exported = node.isExported();
      
      // Get members
      const members: EnumMember[] = [];
      for (const member of node.getMembers()) {
        const memberName = member.getName();
        const initializer = member.getInitializer();
        let value: string | number | undefined;
        
        if (initializer) {
          const text = initializer.getText();
          // Try to parse as number
          const numValue = Number(text.replace(/['"]/g, ''));
          value = isNaN(numValue) ? text.replace(/['"]/g, '') : numValue;
        }
        
        members.push({ name: memberName, value });
      }
      
      // Get JSDoc description
      const jsDocs = node.getJsDocs();
      const description = jsDocs.length > 0
        ? jsDocs[0].getDescription().trim()
        : undefined;
      
      return {
        name,
        file: this.getRelativePath(filePath),
        exported,
        members,
        description
      };
    } catch (error) {
      return null;
    }
  }
  
  /**
   * Extract class information
   */
  private extractClassInfo(node: any, filePath: string): ClassInfo | null {
    try {
      const name = node.getName();
      if (!name) return null;
      
      const exported = node.isExported();
      
      // Get methods
      const methods: MethodInfo[] = [];
      for (const method of node.getMethods()) {
        const methodInfo = this.extractMethodInfo(method);
        if (methodInfo) methods.push(methodInfo);
      }
      
      // Get properties
      const properties: PropertyInfo[] = [];
      for (const prop of node.getProperties()) {
        const propInfo = this.extractPropertyInfo(prop);
        if (propInfo) properties.push(propInfo);
      }
      
      // Get JSDoc description
      const jsDocs = node.getJsDocs();
      const description = jsDocs.length > 0
        ? jsDocs[0].getDescription().trim()
        : undefined;
      
      return {
        name,
        file: this.getRelativePath(filePath),
        exported,
        methods,
        properties,
        description
      };
    } catch (error) {
      return null;
    }
  }
  
  /**
   * Extract method information
   */
  private extractMethodInfo(method: any): MethodInfo | null {
    try {
      const name = method.getName();
      
      // Get parameters
      const parameters: ParameterInfo[] = [];
      for (const param of method.getParameters()) {
        const paramName = param.getName();
        const optional = param.isOptional();
        
        let type = 'unknown';
        try {
          const typeNode = param.getTypeNode();
          if (typeNode) {
            type = typeNode.getText();
          }
        } catch {}
        
        parameters.push({
          name: paramName,
          type,
          optional
        });
      }
      
      // Get return type
      let returnType = 'void';
      try {
        const returnTypeNode = method.getReturnTypeNode();
        if (returnTypeNode) {
          returnType = returnTypeNode.getText();
        }
      } catch {}
      
      // Get JSDoc description
      const jsDocs = method.getJsDocs();
      const description = jsDocs.length > 0
        ? jsDocs[0].getDescription().trim()
        : undefined;
      
      return {
        name,
        parameters,
        returnType,
        description
      };
    } catch (error) {
      return null;
    }
  }
  
  /**
   * Extract property information
   */
  private extractPropertyInfo(prop: any): PropertyInfo | null {
    try {
      const name = prop.getName();
      const optional = prop.hasQuestionToken();
      const readonly = prop.isReadonly();
      
      // Get type
      let type = 'unknown';
      try {
        const typeNode = prop.getTypeNode();
        if (typeNode) {
          type = typeNode.getText();
        }
      } catch {}
      
      // Get JSDoc description
      const jsDocs = prop.getJsDocs();
      const description = jsDocs.length > 0
        ? jsDocs[0].getDescription().trim()
        : undefined;
      
      return {
        name,
        type,
        optional,
        readonly,
        description
      };
    } catch (error) {
      return null;
    }
  }
  
  /**
   * Get relative path from project root
   */
  private getRelativePath(filePath: string): string {
    return path.relative(this.projectPath, filePath);
  }
}

