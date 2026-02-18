import { NextResponse } from 'next/server';
import { obtenerLlantaSistema } from '@/lib/data/sistema-inventario';

export const dynamic = 'force-dynamic';

interface Context {
  params: Promise<{ id: string }>;
}

export async function GET(
  request: Request,
  context: Context
) {
  try {
    const { id } = await context.params;
    const llanta = await obtenerLlantaSistema(id);

    if (!llanta) {
      return NextResponse.json(
        { error: 'Llanta no encontrada' },
        { status: 404 }
      );
    }

    return NextResponse.json(llanta);
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
