import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

type Codec<T> = {
  serialize: (value: T) => string | null;
  parse: (value: string | null) => T;
};

const stringCodec: Codec<string> = {
  serialize: (value) => (value === "" ? null : value),
  parse: (value) => value ?? "",
};

const booleanCodec = (defaultValue: boolean): Codec<boolean> => ({
  serialize: (value) => (value === defaultValue ? null : value ? "1" : "0"),
  parse: (value) => {
    if (value === "1" || value === "true") return true;
    if (value === "0" || value === "false") return false;
    return defaultValue;
  },
});

const numberCodec = (defaultValue: number): Codec<number> => ({
  serialize: (value) => (value === defaultValue ? null : String(value)),
  parse: (value) => {
    if (value === null) return defaultValue;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : defaultValue;
  },
});

const enumCodec = <T extends string>(allowed: readonly T[], defaultValue: T): Codec<T> => ({
  serialize: (value) => (value === defaultValue ? null : value),
  parse: (value) => (value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : defaultValue),
});

export const urlCodec = {
  string: stringCodec,
  boolean: booleanCodec,
  number: numberCodec,
  enum: enumCodec,
};

/**
 * Persist a small piece of UI state in the URL search-params so that page
 * configurations (filters, selected method, etc) become shareable links and
 * survive reloads. Falls back to React state if router is unavailable.
 *
 * Use a stable `paramName` per page+state slot. Codecs serialize defaults to
 * null so the URL stays clean for unmodified values.
 */
export function useUrlState<T>(
  paramName: string,
  codec: Codec<T>,
  initial: T,
): [T, (next: T | ((prev: T) => T)) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialRef = useRef(initial);
  const fromUrl = useMemo(() => codec.parse(searchParams.get(paramName)), [codec, paramName, searchParams]);
  const [value, setValueLocal] = useState<T>(fromUrl ?? initialRef.current);

  // Reflect URL → state when the URL changes from outside.
  useEffect(() => {
    setValueLocal(fromUrl);
  }, [fromUrl]);

  const setValue = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValueLocal((prev) => {
        const resolved = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        const serialized = codec.serialize(resolved);
        setSearchParams(
          (current) => {
            const updated = new URLSearchParams(current);
            if (serialized === null) updated.delete(paramName);
            else updated.set(paramName, serialized);
            return updated;
          },
          { replace: true },
        );
        return resolved;
      });
    },
    [codec, paramName, setSearchParams],
  );

  return [value, setValue];
}
