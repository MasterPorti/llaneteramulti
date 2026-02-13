# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start development server at localhost:3000
npm run build    # Production build
npm run lint     # Run ESLint
npm run start    # Start production server
```

## Project Overview

**Llanta Usada** - Tire shop management system built with Next.js 16 App Router, React 19, TypeScript, and Tailwind CSS 4. The app is in Spanish and manages inventory, sales, services, warranties, and invoicing.

## Architecture

### Data Layer (`lib/data/`)
Data persistence uses JSON files in `data/` directory. Each domain has a data module:
- `inventario.ts` - Tire (llanta) CRUD, multi-warehouse stock tracking, warehouse transfers
- `ventas.ts` - Sales with automatic stock deduction, warranty generation, invoice marking
- `servicios.ts` - Service catalog management

Data modules use `readData()`/`writeData()` pattern with filesystem operations.

### Types (`types/`)
Core domain types with barrel exports via `types/index.ts`:
- `Llanta` - Tire with `stockPorBodega` for multi-warehouse inventory
- `Venta` - Sale with `items[]` (products or services), warranty, invoice info
- `BodegaId` - Warehouse identifier (`'bodega-1'` through `'bodega-4'`)

### Components (`components/`)
Reusable UI primitives in `components/ui/` and layout components in `components/layout/`. Both use barrel exports via `index.ts`.

### Utilities (`lib/utils/formatters.ts`)
Formatting helpers: `formatCurrency()` (MXN), `formatDate()`/`formatDateShort()`/`formatDateTime()`, `parseMedida()`, `generateId()`, `generateFolio()`.

### Configuration (`lib/config.ts`)
Business settings: warehouse list (`BODEGAS`), default warranty days, folio format, service catalog.

### Routes (`app/`)
App Router pages organized by domain:
- `/inventario` - Tire inventory list, detail, edit, stock adjustments, warehouse transfers
- `/ventas` - Sales list, new sale flow (products/services), detail with ticket printing
- `/servicios` - Service catalog management
- `/reportes` - Reports for sales, inventory, warranties, products

### Scripts (`scripts/`)
Standalone scripts for Factura Digital API integration (Mexican electronic invoicing). Require `FACTURA_DIGITAL_API_KEY` in `.env`.

## Key Patterns

- Path alias: `@/*` maps to project root
- Spanish naming in business logic: llanta (tire), venta (sale), bodega (warehouse), garantía (warranty)
- Stock is tracked per-warehouse in `llanta.stockPorBodega`
- Tire measurements use format `205/55R16` (ancho/perfilRrin)
- Sales snapshot product info at time of sale in `llantaSnapshot`
- Soft delete pattern: `activo: boolean` for llantas, `cancelada: boolean` for ventas
