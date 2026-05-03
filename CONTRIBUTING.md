# Contributing to AI Agent OS

Thank you for your interest in contributing to AI Agent OS! This document provides guidelines and instructions for contributing.

---

## 📋 Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Making Changes](#making-changes)
- [Testing](#testing)
- [Pull Request Process](#pull-request-process)
- [Commit Message Guidelines](#commit-message-guidelines)

---

## 📜 Code of Conduct

By participating in this project, you agree to maintain a respectful and inclusive environment for everyone.

**Expected Behavior:**
- Be respectful and considerate
- Use welcoming and inclusive language
- Gracefully accept constructive criticism
- Focus on what is best for the community

---

## 🚀 Getting Started

1. **Fork the repository**
   ```bash
   git clone https://github.com/hosam-pop/ai-agent-os.git
   cd ai-agent-os
   ```

2. **Add upstream remote**
   ```bash
   git remote add upstream https://github.com/hosam-pop/ai-agent-os.git
   ```

3. **Create a feature branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

---

## 💻 Development Setup

### Prerequisites

- Node.js >= 20
- pnpm >= 9 (or npm/bun)
- Git

### Installation

```bash
# Install dependencies
pnpm install

# Copy environment file
cp .env.example .env

# Add your API keys to .env
# ANTHROPIC_API_KEY=sk-ant-...
# OPENAI_API_KEY=sk-...
```

### Build

```bash
# Type check
pnpm typecheck

# Build
pnpm build
```

---

## 🔧 Making Changes

### 1. Keep Changes Focused

- Work on one feature or fix at a time
- Follow existing code style and patterns
- Write clean, readable code

### 2. TypeScript Guidelines

- Use strict mode
- Define interfaces for all data structures
- Use proper typing (avoid `any`)
- Document complex logic

### 3. File Organization

```
src/
├── core/           # Core agent logic
├── api/            # AI providers
├── memory/         # Memory systems
├── tools/          # Tool registry
├── integrations/   # External integrations
├── security/       # Security tools
└── ...
```

---

## 🧪 Testing

### Run All Tests

```bash
pnpm test
```

### Run Specific Tests

```bash
# Unit tests
pnpm test:unit

# Watch mode
pnpm test:watch

# With coverage
pnpm test:coverage
```

### Writing Tests

- Place tests in `tests/unit/` or `tests/integration/`
- Use Vitest framework
- Name test files: `*.test.ts`

```typescript
import { describe, it, expect } from 'vitest';

describe('MyFeature', () => {
  it('should work correctly', () => {
    expect(true).toBe(true);
  });
});
```

---

## 🔄 Pull Request Process

### 1. Before Submitting

- [ ] Run `pnpm typecheck` - no errors
- [ ] Run `pnpm test` - all passing
- [ ] Run `pnpm build` - builds successfully
- [ ] Update documentation if needed
- [ ] Add tests for new features

### 2. Creating Pull Request

1. Push your branch:
   ```bash
   git push origin feature/your-feature-name
   ```

2. Open GitHub Pull Request

3. Fill in the PR template:
   ```markdown
   ## Summary
   Brief description of changes

   ## Type of Change
   - [ ] Bug fix
   - [ ] New feature
   - [ ] Breaking change
   - [ ] Documentation update

   ## Testing
   How was this tested?

   ## Checklist
   - [ ] Code follows style guidelines
   - [ ] Self-review completed
   - [ ] Comments added for complex code
   - [ ] Documentation updated
   ```

### 3. PR Review

- Be responsive to feedback
- Make requested changes
- Keep discussions constructive

---

## 📝 Commit Message Guidelines

Use conventional commits:

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

### Types

| Type | Description |
|------|-------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation changes |
| `style` | Code style changes |
| `refactor` | Code refactoring |
| `test` | Adding/updating tests |
| `chore` | Maintenance tasks |

### Examples

```bash
feat(core): add agent loop optimization
fix(memory): resolve memory leak in short-term storage
docs(readme): update installation instructions
test(agent): add unit tests for planner
refactor(api): simplify provider interface
```

---

## 🐛 Reporting Issues

When reporting issues, include:

- **Description** - Clear problem description
- **Steps to Reproduce** - How to reproduce the issue
- **Expected Behavior** - What should happen
- **Actual Behavior** - What happens instead
- **Environment** - Node version, OS, etc.

---

## 📚 Resources

- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Vitest Documentation](https://vitest.dev/)
- [Fastify Docs](https://www.fastify.io/)
- [Anthropic SDK](https://docs.anthropic.com/)

---

## 💬 Questions?

Feel free to:
- Open an issue for questions
- Join discussions
- Reach out to maintainers

---

**Thank you for contributing to AI Agent OS! 🎉**