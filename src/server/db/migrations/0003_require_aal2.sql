-- 2FA (aal2) obrigatório também na RLS.
--
-- A URL e a chave publishable do Supabase são públicas e a Data API (PostgREST) aceita
-- qualquer JWT de usuário. Quem sabe só a SENHA obtém um JWT `aal1` direto no Auth e,
-- sem esta política, lia e escrevia as tabelas sem nunca passar pelo TOTP. Política
-- RESTRICTIVE: soma-se (E) às políticas permissivas; sem `aal2` no JWT nada passa.
--
-- REGRA para toda tabela nova de `public` acessível a `authenticated`: criar uma política
-- igual a esta (o teste de catálogo em src/server/db/catalog.test.ts falha se faltar).

CREATE POLICY profiles_require_aal2 ON public.profiles
	AS RESTRICTIVE
	FOR ALL
	TO authenticated
	USING (((SELECT auth.jwt()) ->> 'aal') = 'aal2')
	WITH CHECK (((SELECT auth.jwt()) ->> 'aal') = 'aal2');
