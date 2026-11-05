"use client";

import Image from "next/image";
import { useActionState } from "react";

import { FormError } from "@/components/auth/form-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  startMfaEnroll,
  verifyMfaEnroll,
  type EnrollStartResult,
} from "@/server/auth/actions";

/** Chave em grupos de 4 para facilitar a digitação manual. */
function groupSecret(secret: string): string {
  return secret.replace(/\s+/g, "").replace(/(.{4})/g, "$1 ").trim();
}

export function MfaEnroll() {
  const [started, startAction, starting] = useActionState<
    EnrollStartResult | undefined
  >(async () => startMfaEnroll(), undefined);
  const [verifyState, verifyAction, verifying] = useActionState(
    verifyMfaEnroll,
    undefined,
  );

  if (!started?.ok) {
    return (
      <div className="flex flex-col gap-4">
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          <li>
            Instale um app autenticador no celular (Google Authenticator,
            Microsoft Authenticator, Authy…).
          </li>
          <li>Gere o QR Code abaixo e escaneie com o app.</li>
          <li>Digite o código de 6 dígitos que o app mostrar.</li>
        </ol>
        {started && !started.ok ? <FormError message={started.error} /> : null}
        <form action={startAction}>
          <Button type="submit" disabled={starting} className="h-11 w-full text-base">
            {starting ? "Gerando…" : "Gerar QR Code"}
          </Button>
        </form>
      </div>
    );
  }

  return (
    <form action={verifyAction} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col items-center gap-3">
        <Image
          src={started.qrCode}
          alt="QR Code para cadastrar o app autenticador"
          width={200}
          height={200}
          unoptimized
          className="rounded-lg border bg-white p-2"
        />
        <p className="text-center text-sm text-muted-foreground">
          Não consegue escanear? No app, escolha &ldquo;inserir chave&rdquo; e digite:
        </p>
        <code
          className="select-all rounded-md bg-muted px-3 py-1.5 font-mono text-sm tracking-wider"
          data-testid="mfa-secret"
        >
          {groupSecret(started.secret)}
        </code>
      </div>

      <FormError message={verifyState?.error} />
      <input type="hidden" name="factorId" value={started.factorId} />

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

      <Button type="submit" disabled={verifying} className="h-11 w-full text-base">
        {verifying ? "Confirmando…" : "Confirmar e entrar"}
      </Button>
    </form>
  );
}
