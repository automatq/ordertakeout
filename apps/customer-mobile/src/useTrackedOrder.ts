import { useCallback, useEffect, useState } from "react";

import { fetchOrder, type CustomerOrder } from "./api";
import { reportNonFatal } from "./nonfatal";
import { loadSavedOrder, saveOrder, type SavedOrder } from "./saved-order";

export interface TrackedOrder {
  order: CustomerOrder | null;
  today: string | null;
  saved: SavedOrder | null;
  /** Showing a stored copy because the shop could not be reached. */
  offline: boolean;
  /** The server says there is no such order, or the key no longer opens it. */
  gone: boolean;
  refreshing: boolean;
  refresh: () => Promise<void>;
  onPullToRefresh: () => Promise<void>;
}

/**
 * The order this app is currently following.
 *
 * Reads the stored copy first and the network second, and that order is the
 * whole point: the one moment this has to work is standing at a counter with no
 * signal, and a screen that waits on the network is a screen that shows a
 * spinner exactly then.
 *
 * Shared by the tracking screen and the pickup pass so the two can never
 * disagree about what is being collected.
 */
export function useTrackedOrder(
  orderNumber: string | null,
  accessKey: string | null,
): TrackedOrder {
  const [saved, setSaved] = useState<SavedOrder | null>(null);
  const [order, setOrder] = useState<CustomerOrder | null>(null);
  const [today, setToday] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [gone, setGone] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    if (!orderNumber || !accessKey) return;
    try {
      const result = await fetchOrder(orderNumber, accessKey);
      if (!result.ok) {
        // Keep showing the stored copy and say it might be out of date.
        setOffline(true);
        return;
      }
      setOffline(false);
      if (!result.data.found) {
        setGone(true);
        return;
      }
      setOrder(result.data.order);
      setToday(result.data.today);
      await saveOrder(orderNumber, accessKey, result.data.order);
    } catch (cause) {
      reportNonFatal("refreshing tracked order", cause);
      setOffline(true);
    }
  }, [orderNumber, accessKey]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const stored = await loadSavedOrder();
      if (!active) return;
      if (stored && (!orderNumber || stored.orderNumber === orderNumber)) {
        setSaved(stored);
        setOrder(stored.order);
      }
      await refresh();
    })().catch((cause) => {
      reportNonFatal("opening tracked order", cause);
      if (active) setOffline(true);
    });
    return () => {
      active = false;
    };
  }, [orderNumber, refresh]);

  const onPullToRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }, [refresh]);

  return { order, today, saved, offline, gone, refreshing, refresh, onPullToRefresh };
}
