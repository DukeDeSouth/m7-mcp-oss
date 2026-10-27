/**
 * TechSafety Rules Configuration
 * База знаний о проблемных технологиях для AI и безопасных альтернативах
 */

export interface TechRule {
  technology: string;
  riskLevel: 'high' | 'medium' | 'low';
  commonIssues: string[];
  safeAlternatives: {
    name: string;
    when: string;
    tradeoffs?: string;
  }[];
  bestPractices: string[];
  detectPatterns: string[]; // Паттерны для обнаружения в задаче
  context7Query?: string; // Запрос для Context7
  lastVerified?: string; // Когда последний раз проверяли
}

export const TECH_SAFETY_RULES: TechRule[] = [
  {
    technology: 'TypeScript',
    riskLevel: 'high',
    context7Query: 'typescript',
    lastVerified: '2024-04-01', // Устарело!
    commonIssues: [
      'Сложные generic типы вызывают галлюцинации',
      'Путаница между типами и runtime значениями',
      'Неправильные type guards и type assertions',
      'Избыточно сложные conditional types'
    ],
    safeAlternatives: [
      {
        name: 'JavaScript с JSDoc',
        when: 'Простая бизнес-логика без сложных типов',
        tradeoffs: 'Меньше type safety, но проще для AI'
      },
      {
        name: 'TypeScript с простыми типами',
        when: 'Нужна базовая типизация',
        tradeoffs: 'Избегать generics и conditional types'
      }
    ],
    bestPractices: [
      'Использовать простые interface вместо сложных type',
      'Избегать вложенных generics',
      'Предпочитать явные типы вместо inference'
    ],
    detectPatterns: ['typescript', 'ts', 'типизация', 'types', 'interface', 'generic']
  },
  
  {
    technology: 'Next.js App Router',
    riskLevel: 'high',
    context7Query: 'next.js app router',
    lastVerified: '2024-04-01',
    commonIssues: [
      'Путаница между App Router и Pages Router',
      'Неправильное использование Server Components',
      'Ошибки с "use client" директивой',
      'Проблемы с metadata и generateStaticParams'
    ],
    safeAlternatives: [
      {
        name: 'Next.js Pages Router',
        when: 'Классическая SSR/SSG архитектура',
        tradeoffs: 'Старая парадигма, но стабильная'
      },
      {
        name: 'Express.js + React',
        when: 'Простое приложение без SSR',
        tradeoffs: 'Больше контроля, меньше магии'
      },
      {
        name: 'Vite + React',
        when: 'SPA без SSR требований',
        tradeoffs: 'Быстрая разработка, простая настройка'
      }
    ],
    bestPractices: [
      'Явно указывать "use client" где нужно',
      'Разделять серверные и клиентские компоненты',
      'Использовать документацию Next.js 14+'
    ],
    detectPatterns: ['next.js', 'nextjs', 'app router', 'app directory', 'server components']
  },
  
  {
    technology: 'Tailwind CSS',
    riskLevel: 'medium',
    context7Query: 'tailwindcss',
    lastVerified: '2024-04-01',
    commonIssues: [
      'Неправильные или несуществующие классы',
      'Конфликты с custom CSS',
      'Сложные responsive правила',
      'Проблемы с dynamic классами'
    ],
    safeAlternatives: [
      {
        name: 'CSS Modules',
        when: 'Component-scoped стили',
        tradeoffs: 'Больше кода, но предсказуемо'
      },
      {
        name: 'Styled Components',
        when: 'CSS-in-JS подход',
        tradeoffs: 'Runtime overhead, но type-safe'
      },
      {
        name: 'Vanilla CSS',
        when: 'Простые стили',
        tradeoffs: 'Полный контроль'
      }
    ],
    bestPractices: [
      'Использовать Tailwind IntelliSense',
      'Избегать dynamic классов через интерполяцию',
      'Создавать компоненты для повторяющихся паттернов'
    ],
    detectPatterns: ['tailwind', 'tailwindcss', 'классы стилей', 'utility classes']
  },
  
  {
    technology: 'Prisma',
    riskLevel: 'medium',
    context7Query: 'prisma',
    lastVerified: '2024-04-01',
    commonIssues: [
      'Сложные schema отношения',
      'Проблемы с миграциями',
      'Неоптимальные queries (N+1)',
      'Путаница с Prisma Client генерацией'
    ],
    safeAlternatives: [
      {
        name: 'Raw SQL с pg/mysql2',
        when: 'Простые запросы',
        tradeoffs: 'Больше контроля, меньше абстракций'
      },
      {
        name: 'Knex.js',
        when: 'Нужен query builder',
        tradeoffs: 'Легче чем ORM, гибче'
      },
      {
        name: 'TypeORM',
        when: 'Нужна полноценная ORM',
        tradeoffs: 'Более традиционный подход'
      }
    ],
    bestPractices: [
      'Начинать с простой схемы',
      'Использовать Prisma Studio для отладки',
      'Явно указывать include/select'
    ],
    detectPatterns: ['prisma', 'orm', 'database schema', 'миграции']
  },
  
  {
    technology: 'GraphQL',
    riskLevel: 'high',
    context7Query: 'graphql',
    lastVerified: '2024-04-01',
    commonIssues: [
      'Сложные resolver chains',
      'Schema type mismatches',
      'Over-fetching/Under-fetching',
      'Проблемы с subscriptions'
    ],
    safeAlternatives: [
      {
        name: 'REST API',
        when: 'CRUD операции',
        tradeoffs: 'Проще, предсказуемее'
      },
      {
        name: 'tRPC',
        when: 'Type-safe API в монорепо',
        tradeoffs: 'Только для TypeScript'
      },
      {
        name: 'JSON-RPC',
        when: 'Простые RPC вызовы',
        tradeoffs: 'Минималистично'
      }
    ],
    bestPractices: [
      'Использовать GraphQL Code Generator',
      'Держать схему простой',
      'Избегать глубокой вложенности'
    ],
    detectPatterns: ['graphql', 'apollo', 'resolver', 'schema', 'query', 'mutation']
  },
  
  {
    technology: 'Redux Toolkit',
    riskLevel: 'medium',
    context7Query: 'redux toolkit',
    lastVerified: '2024-04-01',
    commonIssues: [
      'Путаница между RTK и классическим Redux',
      'Сложные async thunks',
      'Проблемы с RTK Query',
      'Избыточная нормализация'
    ],
    safeAlternatives: [
      {
        name: 'Zustand',
        when: 'Простое глобальное состояние',
        tradeoffs: 'Минималистично, легко'
      },
      {
        name: 'React Context + useReducer',
        when: 'Встроенное решение',
        tradeoffs: 'Может быть медленнее для больших apps'
      },
      {
        name: 'Jotai/Valtio',
        when: 'Atomic state management',
        tradeoffs: 'Современный подход'
      }
    ],
    bestPractices: [
      'Использовать createSlice вместо отдельных reducers',
      'Избегать сложной логики в reducers',
      'Использовать RTK Query для API'
    ],
    detectPatterns: ['redux', 'rtk', 'store', 'slice', 'reducer', 'состояние']
  },
  
  {
    technology: 'React Server Components',
    riskLevel: 'high',
    context7Query: 'react server components',
    lastVerified: '2024-04-01',
    commonIssues: [
      'Путаница между серверными и клиентскими компонентами',
      'Проблемы с границами клиент/сервер',
      'Неправильная передача props',
      'Ошибки сериализации'
    ],
    safeAlternatives: [
      {
        name: 'Обычные React компоненты',
        when: 'SPA приложение',
        tradeoffs: 'Все на клиенте, проще'
      },
      {
        name: 'SSG с getStaticProps',
        when: 'Статический контент',
        tradeoffs: 'Build-time генерация'
      }
    ],
    bestPractices: [
      'Четко разделять серверные и клиентские компоненты',
      'Понимать границы сериализации',
      'Использовать "use client" явно'
    ],
    detectPatterns: ['rsc', 'server components', 'use server', 'серверные компоненты']
  },
  
  {
    technology: 'Monorepo (Turborepo/Nx)',
    riskLevel: 'medium',
    context7Query: 'turborepo',
    lastVerified: '2024-04-01',
    commonIssues: [
      'Сложная конфигурация',
      'Проблемы с зависимостями',
      'Build order issues',
      'Workspace configuration'
    ],
    safeAlternatives: [
      {
        name: 'Отдельные репозитории',
        when: 'Независимые проекты',
        tradeoffs: 'Проще управлять'
      },
      {
        name: 'npm workspaces',
        when: 'Простое разделение пакетов',
        tradeoffs: 'Встроенное решение'
      }
    ],
    bestPractices: [
      'Начинать с простой структуры',
      'Использовать автоматизацию',
      'Четкие границы между пакетами'
    ],
    detectPatterns: ['monorepo', 'turborepo', 'nx', 'workspaces', 'lerna']
  }
];

/**
 * Анализирует задачу на наличие проблемных технологий
 */
export function analyzeTaskForRisks(taskDescription: string): {
  detectedTechnologies: TechRule[];
  overallRisk: 'high' | 'medium' | 'low';
  recommendations: string[];
} {
  const lowercaseTask = taskDescription.toLowerCase();
  const detected: TechRule[] = [];
  
  // Проверяем каждую технологию
  for (const rule of TECH_SAFETY_RULES) {
    const isDetected = rule.detectPatterns.some(pattern => 
      lowercaseTask.includes(pattern.toLowerCase())
    );
    
    if (isDetected) {
      detected.push(rule);
    }
  }
  
  // Определяем общий уровень риска
  const hasHighRisk = detected.some(r => r.riskLevel === 'high');
  const hasMediumRisk = detected.some(r => r.riskLevel === 'medium');
  
  const overallRisk: 'high' | 'medium' | 'low' = 
    hasHighRisk ? 'high' : hasMediumRisk ? 'medium' : 'low';
  
  // Формируем рекомендации
  const recommendations: string[] = [];
  
  if (detected.length > 0) {
    recommendations.push(`⚠️ Обнаружено ${detected.length} проблемных технологий`);
    
    for (const tech of detected) {
      if (tech.riskLevel === 'high') {
        recommendations.push(`🔴 ${tech.technology}: Рассмотрите альтернативы`);
        if (tech.safeAlternatives.length > 0) {
          recommendations.push(`   → Рекомендуем: ${tech.safeAlternatives[0].name}`);
        }
      } else if (tech.riskLevel === 'medium') {
        recommendations.push(`🟡 ${tech.technology}: Используйте с осторожностью`);
        recommendations.push(`   → ${tech.bestPractices[0]}`);
      }
    }
  } else {
    recommendations.push('✅ Проблемных технологий не обнаружено');
  }
  
  return {
    detectedTechnologies: detected,
    overallRisk,
    recommendations
  };
}

/**
 * Генерирует подробный отчет о безопасности технологий
 */
export function generateSafetyReport(detected: TechRule[]): string {
  if (detected.length === 0) {
    return '✅ Все технологии безопасны для использования с AI';
  }
  
  let report = '# 🛡️ Tech Safety Report\n\n';
  report += '⚠️ **WARNING**: This analysis is based on data from April 2024!\n';
  report += '🔄 **REQUIRED**: Use @context7 to verify current documentation\n\n';
  
  for (const tech of detected) {
    report += `## ${tech.technology} (Risk: ${tech.riskLevel})\n\n`;
    
    // Добавляем информацию о Context7
    if (tech.context7Query) {
      report += `🔍 **Verify Current Version with Context7:**\n`;
      report += `\`\`\`\n`;
      report += `@context7 resolve-library "${tech.context7Query}"\n`;
      report += `@context7 get-library-docs [library-id] topic:"latest features"\n`;
      report += `\`\`\`\n\n`;
    }
    
    if (tech.lastVerified) {
      const monthsOld = Math.floor((Date.now() - new Date(tech.lastVerified).getTime()) / (1000 * 60 * 60 * 24 * 30));
      report += `⚠️ **Data Age**: ${monthsOld} months old (verified: ${tech.lastVerified})\n\n`;
    }
    
    report += '### Known Issues (AS OF APRIL 2024):\n';
    tech.commonIssues.forEach(issue => {
      report += `- ${issue}\n`;
    });
    
    report += '\n### Safe Alternatives:\n';
    tech.safeAlternatives.forEach(alt => {
      report += `- **${alt.name}**: ${alt.when}\n`;
      if (alt.tradeoffs) {
        report += `  Trade-offs: ${alt.tradeoffs}\n`;
      }
    });
    
    report += '\n### Best Practices:\n';
    tech.bestPractices.forEach(practice => {
      report += `- ${practice}\n`;
    });
    
    report += '\n---\n\n';
  }
  
  report += '\n---\n';
  report += '🚨 **CRITICAL REMINDER**: All recommendations above are based on April 2024 data!\n';
  report += '📅 Current date is ' + new Date().toLocaleDateString() + '\n';
  report += '🔄 You MUST verify with @context7 before making final recommendations.\n';
  
  return report;
}

/**
 * Генерирует инструкции для проверки через Context7
 */
export function generateContext7Instructions(detected: TechRule[]): string {
  if (detected.length === 0) return '';
  
  let instructions = '## 🔍 Context7 Verification Required:\n\n';
  
  detected.forEach((tech, index) => {
    instructions += `**${index + 1}. Verify ${tech.technology}:**\n`;
    
    const query = tech.context7Query || tech.technology.toLowerCase();
    instructions += `\`\`\`bash\n`;
    instructions += `# Step 1: Find the library\n`;
    instructions += `@context7 resolve-library "${query}"\n\n`;
    instructions += `# Step 2: Get current documentation\n`;
    instructions += `@context7 get-library-docs [library-id] topic:"breaking changes"\n`;
    instructions += `@context7 get-library-docs [library-id] topic:"best practices"\n`;
    instructions += `@context7 get-library-docs [library-id] topic:"typescript support"\n`;
    instructions += `\`\`\`\n\n`;
  });
  
  instructions += '**What to check:**\n';
  instructions += '- Have the issues from 2024 been fixed?\n';
  instructions += '- Are there new features that make it safer for AI?\n';
  instructions += '- Has TypeScript support improved?\n';
  instructions += '- Are there new best practices?\n\n';
  
  return instructions;
}

/**
 * Проверяет устаревание данных
 */
export function checkDataFreshness(): { 
  isCritical: boolean; 
  monthsOld: number; 
  message: string 
} {
  const lastUpdate = new Date('2024-04-01');
  const now = new Date();
  const monthsOld = Math.floor((now.getTime() - lastUpdate.getTime()) / (1000 * 60 * 60 * 24 * 30));
  
  return {
    isCritical: monthsOld > 6,
    monthsOld,
    message: monthsOld > 12 
      ? `🚨 CRITICAL: Data is ${monthsOld} months old! Context7 verification is MANDATORY!`
      : monthsOld > 6
      ? `⚠️ WARNING: Data is ${monthsOld} months old. Context7 verification strongly recommended.`
      : `📅 Data is ${monthsOld} months old. Consider Context7 verification.`
  };
}
