-- Pacientes (1B-3a): UPDATE só nas colunas editáveis. Com o UPDATE de tabela inteira (0018), a
-- recepção poderia trocar patient_id (mover o CPF e o endereço de um paciente para outro) ou o id
-- do paciente: a política de linha só olha papel e paciente não removido, não a chave. Sem o
-- privilégio de UPDATE nas colunas de chave (id/patient_id) e em created_at, trocar a chave falha
-- com 42501. As demais regras da 0018 seguem iguais.

REVOKE UPDATE ON TABLE public.patients, public.patient_private FROM authenticated;--> statement-breakpoint
GRANT UPDATE (full_name, birth_date, phone, email, active, updated_at, deleted_at)
	ON TABLE public.patients TO authenticated;--> statement-breakpoint
GRANT UPDATE (
	cpf, no_cpf_reason, cep, street, number, complement, district, city, state,
	insurance_id, insurance_card, guardian_name, guardian_relationship, guardian_phone,
	guardian_cpf, admin_notes, updated_at
) ON TABLE public.patient_private TO authenticated;
