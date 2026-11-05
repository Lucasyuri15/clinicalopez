-- Limite de tentativas de login/2FA: grants e funções (a tabela vem na 0004).
--
-- O app fala com o banco como `app_backend`, que NÃO tem privilégio em nenhuma tabela. A
-- tabela `auth_attempts` fica fechada (RLS ligada, sem política, sem grant para
-- anon/authenticated/app_backend, ou seja, nem pela Data API) e só estas duas funções
-- SECURITY DEFINER (donas: `postgres`, que ignora a RLS) a tocam. Elas só CONTAM e
-- REGISTRAM; a política (quantas falhas, quanto esperar) fica no app (rate-limit-policy.ts).
-- Execução só para `app_backend`.

REVOKE ALL ON TABLE public.auth_attempts FROM PUBLIC, anon, authenticated;--> statement-breakpoint

-- app_backend nunca teve acesso ao schema `app` (só `authenticated` tinha USAGE): sem isto
-- nem enxerga as funções abaixo.
GRANT USAGE ON SCHEMA app TO app_backend;--> statement-breakpoint

-- Inicia uma tentativa. Devolve as contagens de ANTES dela (na janela) e o ID da linha que
-- acabou de gravar. A linha é gravada ANTES de o app chamar o Supabase: tentativas em
-- paralelo não conseguem todas "ver zero falhas". Os dois locks (IP e par) serializam
-- só as tentativas do mesmo IP/par; são de transação e caem ao fim desta chamada. A ordem
-- (IP, depois par) é sempre a mesma, então não há deadlock.
CREATE OR REPLACE FUNCTION app.rate_limit_begin(
	p_kind text,
	p_ip text,
	p_subject_hash text,
	p_window_s integer
)
RETURNS TABLE (
	attempt_id bigint,
	ip_failures integer,
	ip_last_age_s integer,
	pair_failures integer,
	pair_last_age_s integer,
	subject_failures integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
	v_now timestamptz;
	v_since timestamptz;
BEGIN
	IF p_kind IS NULL OR p_kind NOT IN ('login', 'mfa') THEN
		RAISE EXCEPTION 'rate_limit_begin: tipo inválido' USING ERRCODE = '22023';
	END IF;
	IF p_window_s IS NULL OR p_window_s < 1 OR p_window_s > 86400 THEN
		RAISE EXCEPTION 'rate_limit_begin: janela fora de 1 s a 24 h' USING ERRCODE = '22023';
	END IF;

	PERFORM pg_advisory_xact_lock(hashtextextended('rate_limit:ip:' || p_kind || ':' || p_ip, 0));
	PERFORM pg_advisory_xact_lock(
		hashtextextended('rate_limit:pair:' || p_kind || ':' || p_subject_hash || ':' || p_ip, 0)
	);

	-- Depois dos locks: o relógio é o de agora, não o de antes de esperar.
	v_now := clock_timestamp();
	v_since := v_now - make_interval(secs => p_window_s);

	-- Limpeza oportunista (sem cron): nada com mais de 1 dia é útil.
	DELETE FROM public.auth_attempts AS a WHERE a.created_at < v_now - interval '1 day';

	SELECT count(*)::integer, floor(extract(epoch FROM (v_now - max(a.created_at))))::integer
		INTO ip_failures, ip_last_age_s
		FROM public.auth_attempts AS a
		WHERE a.kind = p_kind AND a.ip = p_ip AND a.created_at > v_since;

	SELECT count(*)::integer, floor(extract(epoch FROM (v_now - max(a.created_at))))::integer
		INTO pair_failures, pair_last_age_s
		FROM public.auth_attempts AS a
		WHERE a.kind = p_kind AND a.ip = p_ip AND a.subject_hash = p_subject_hash
			AND a.created_at > v_since;

	SELECT count(*)::integer
		INTO subject_failures
		FROM public.auth_attempts AS a
		WHERE a.kind = p_kind AND a.subject_hash = p_subject_hash AND a.created_at > v_since;

	-- Entrada inválida (IP vazio/gigante, hash que não é SHA-256) para aqui, nos CHECKs da tabela.
	INSERT INTO public.auth_attempts (kind, ip, subject_hash, created_at)
		VALUES (p_kind, p_ip, p_subject_hash, v_now)
		RETURNING id INTO attempt_id;

	RETURN NEXT;
END
$$;--> statement-breakpoint

-- Encerra uma tentativa: apaga a linha dela. Com `p_forgive` (login que deu certo), apaga
-- também as falhas anteriores do MESMO par (tipo + IP + e-mail/usuário), e só dele.
-- ID inexistente não é erro.
CREATE OR REPLACE FUNCTION app.rate_limit_release(p_attempt_id bigint, p_forgive boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
	v_kind text;
	v_ip text;
	v_subject text;
BEGIN
	DELETE FROM public.auth_attempts AS a
		WHERE a.id = p_attempt_id
		RETURNING a.kind, a.ip, a.subject_hash INTO v_kind, v_ip, v_subject;

	IF p_forgive AND v_kind IS NOT NULL THEN
		DELETE FROM public.auth_attempts AS a
			WHERE a.kind = v_kind AND a.ip = v_ip AND a.subject_hash = v_subject;
	END IF;
END
$$;--> statement-breakpoint

-- Funções novas em `app` nascem executáveis por PUBLIC: fecha e abre só para o app_backend.
REVOKE ALL ON FUNCTION app.rate_limit_begin(text, text, text, integer) FROM PUBLIC, anon, authenticated;--> statement-breakpoint
REVOKE ALL ON FUNCTION app.rate_limit_release(bigint, boolean) FROM PUBLIC, anon, authenticated;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.rate_limit_begin(text, text, text, integer) TO app_backend;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.rate_limit_release(bigint, boolean) TO app_backend;
