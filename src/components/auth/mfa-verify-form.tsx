"use client";

import { useActionState } from "react";

import { FormError } from "@/components/auth/form-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { verifyMfaLogin } from "@/server/auth/actions";

export function MfaVerifyForm() {
  const [state, action, pending] = useActionState(verifyMfaLogin, undefined);

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormError message={state?.error} />

      <div className="flex flex-col gap-1.5">
        <label htmlFor="code" className="text-sm font-medium">
          Código de 6 dígitos
        </label>
        <Input
          id="code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]*"
          maxLength={7}
          placeholder="000000"
          className="text-center font-mono text-lg tracking-widest"
          required
          autoFocus
        />
      </div>

      <Button type="submit" disabled={pending} className="h-11 w-full text-base">
        {pending ? "Verificando…" : "Verificar"}
      </Button>
    </form>
  );
}
