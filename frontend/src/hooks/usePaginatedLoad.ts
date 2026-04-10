import { useEffect, useRef, useState, useCallback } from 'react';

export interface PaginatedLoadOptions<T> {
  initialItems?: T[];
  preloadThreshold?: number; // px 距離底部時觸發預加載
  pageSize?: number;
}

export interface PaginatedLoadResult<T> {
  items: T[];
  page: number;
  hasMore: boolean;
  isLoading: boolean;
  error: Error | null;
  loadMore: () => void;
  reset: () => void;
  sentinelRef: React.RefObject<HTMLDivElement>; // Sentinel 元素用於預加載觸發
}

/**
 * 通用分頁加載 Hook
 * 支持推薦、搜尋、單頻道等場景
 * 
 * @param fetchFn 非同步取得函數 (page) => { items: T[], hasMore: boolean }
 * @param options 配置選項
 * @returns 分頁狀態與操作方法
 */
export function usePaginatedLoad<T>(
  fetchFn: (page: number) => Promise<{ items: T[]; hasMore: boolean }>,
  options: PaginatedLoadOptions<T> = {}
): PaginatedLoadResult<T> {
  const {
    initialItems = [],
    preloadThreshold = 800,
    pageSize: _pageSize = 5,
  } = options;

  const [items, setItems] = useState<T[]>(initialItems);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const lastLoadTimeRef = useRef<number>(0);
  const isLoadingRef = useRef(false);

  // 返流防抖：同一時間最多只能觸發一次加載
  const performLoad = useCallback(
    async (nextPage: number) => {
      if (isLoadingRef.current || !hasMore) return;
      if (Date.now() - lastLoadTimeRef.current < 300) return; // 300ms 防抖

      isLoadingRef.current = true;
      setIsLoading(true);
      lastLoadTimeRef.current = Date.now();

      try {
        const result = await fetchFn(nextPage);
        setItems((prev) => [...prev, ...result.items]);
        setPage(nextPage + 1);
        setHasMore(result.hasMore);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Load failed'));
      } finally {
        isLoadingRef.current = false;
        setIsLoading(false);
      }
    },
    [fetchFn, hasMore]
  );

  // Sentinel 檢測器：距離底部 preloadThreshold px 時觸發預加載
  useEffect(() => {
    if (!sentinelRef.current || !hasMore) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !isLoadingRef.current) {
          performLoad(page);
        }
      },
      {
        rootMargin: `${preloadThreshold}px 0px 0px 0px`, // 距離底部 preloadThreshold px
        threshold: 0, // 任何可見部分就觸發
      }
    );

    observer.observe(sentinelRef.current);
    observerRef.current = observer;

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [page, hasMore, preloadThreshold, performLoad]);

  // 手動加載更多
  const loadMore = useCallback(() => {
    performLoad(page);
  }, [page, performLoad]);

  // 重置狀態
  const reset = useCallback(() => {
    setItems(initialItems);
    setPage(0);
    setHasMore(true);
    setIsLoading(false);
    setError(null);
    isLoadingRef.current = false;
  }, [initialItems]);

  return {
    items,
    page,
    hasMore,
    isLoading,
    error,
    loadMore,
    reset,
    sentinelRef,
  };
}
