import { SQIPCardEntry, SQIPCore, type CardDetails } from "react-native-square-in-app-payments";

/**
 * The card-entry criteria, driven from the UI.
 *
 * Note what is NOT here: `completeCardEntry()` and `showCardNonceProcessingError()`.
 * The Phase 3 plan was written against those, and 2.1.1 deprecates both. The
 * modern flow hands `startCardEntryFlow` an async callback that returns a
 * result, so the server round-trip and the in-sheet error are one expression:
 *
 *   return { success: false, errorMessage: "Card declined" }   // stays open
 *   return { success: true }                                   // dismisses
 *
 * That is a straight improvement for Harina — `payForOrder` is a server call
 * that can fail, and this is exactly the shape needed to surface that failure
 * without the sheet having already gone away.
 */

export interface NonceOutcome {
  nonce: string;
  looksLikeCardNonce: boolean;
  brand: string;
  lastFour: string;
}

export function configure(applicationId: string): void {
  SQIPCore.setSquareApplicationId(applicationId);
}

/** Present the sheet and settle it as success. Resolves with what came back. */
export function collectNonce(): Promise<NonceOutcome | "cancelled"> {
  return new Promise((resolve) => {
    SQIPCardEntry.startCardEntryFlow(
      true,
      (cardDetails: CardDetails) => {
        const nonce = cardDetails.nonce ?? "";
        resolve({
          nonce,
          /* Square's card nonces are `cnon:`-prefixed. Anything else means we
             are holding a token the payments API will reject. */
          looksLikeCardNonce: nonce.startsWith("cnon:"),
          brand: String(cardDetails.card?.brand ?? "?"),
          lastFour: cardDetails.card?.lastFourDigits ?? "?",
        });
        return { success: true };
      },
      () => resolve("cancelled"),
    );
  });
}

/**
 * Present the sheet and refuse the nonce, the way a declined server-side charge
 * would. The sheet must stay up with the message visible — if it dismisses, the
 * customer loses their typed card and the app has to ask for it again.
 *
 * This one cannot self-verify, and says so rather than pretending. From JS both
 * outcomes look identical: the callback returns, and later the cancel callback
 * fires. Whether the message was actually on screen in between is something only
 * the person holding the phone can see. All this reports is that the rejection
 * was delivered and the flow ended without crashing.
 */
export function rejectNonceInSheet(message: string): Promise<"rejected" | "cancelled"> {
  return new Promise((resolve) => {
    let rejected = false;
    SQIPCardEntry.startCardEntryFlow(
      true,
      () => {
        rejected = true;
        return { success: false, errorMessage: message };
      },
      () => resolve(rejected ? "rejected" : "cancelled"),
    );
  });
}

/**
 * Open and cancel the sheet `times` over, to shake out the presentation leak
 * that legacy-interop TurboModules are prone to. The tester taps Cancel; this
 * counts and immediately reopens.
 */
export async function cycleOpenCancel(
  times: number,
  onProgress: (done: number) => void,
): Promise<number> {
  for (let i = 0; i < times; i++) {
    const outcome = await new Promise<"cancelled" | "submitted">((resolve) => {
      SQIPCardEntry.startCardEntryFlow(
        true,
        () => {
          resolve("submitted");
          return { success: true };
        },
        () => resolve("cancelled"),
      );
    });
    onProgress(i + 1);
    // A submitted card ends the run early rather than silently counting it as a
    // cancel — the leak this looks for is in the dismiss path.
    if (outcome === "submitted") return i + 1;
  }
  return times;
}
