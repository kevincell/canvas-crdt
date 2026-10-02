import { useCallback, useEffect, useState } from 'react';
import { type Shape } from '@crdt-canvas/engine';
import { deleteStencil, listStencils, saveStencil, type Stencil } from './stencilStore';

export function useStencils() {
  const [stencils, setStencils] = useState<Stencil[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStencils(await listStencils());
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load the stencil library.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const save = useCallback(async (name: string, shapes: Shape[]) => {
    const saved = await saveStencil(name, shapes);
    await refresh();
    return saved;
  }, [refresh]);

  const remove = useCallback(async (id: string) => {
    await deleteStencil(id);
    await refresh();
  }, [refresh]);

  return { stencils, loading, error, save, remove };
}
