/**
 * M7 v3.2 - Verification Module
 * 
 * Экспорты модуля верификации:
 * - Symbol Verifier
 * - Gordian Knot Detector
 */

export {
  SymbolVerifier,
  getSymbolVerifier,
  type SymbolLocation,
  type SimilarSymbol,
  type SymbolVerifyResult,
  type BatchVerifyResult
} from './symbolVerifier.js';

export {
  GordianKnotDetector,
  getGordianKnotDetector,
  type KnotSeverity,
  type KnotType,
  type GordianKnot,
  type KnotDetectionResult
} from './gordianKnotDetector.js';

