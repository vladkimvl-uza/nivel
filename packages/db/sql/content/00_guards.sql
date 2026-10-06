-- WP-06: published legal documents are immutable and carry the hash of their text (ARCHITECTURE 3.1, 3.4).

CREATE FUNCTION content.guard_legal_document() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.status = 'published' THEN
    RAISE EXCEPTION 'immutable: a published % version % (%) cannot be changed or removed', OLD.kind, OLD.version, OLD.lang
      USING ERRCODE = 'check_violation', HINT = 'Publish a new version; consents refer to the hash of the old text.';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF NEW.status = 'published'
     AND NEW.text_sha256 <> encode(sha256(convert_to(NEW.body_md, 'UTF8')), 'hex') THEN
    RAISE EXCEPTION 'text_hash_mismatch: text_sha256 of % version % does not match its text', NEW.kind, NEW.version
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER legal_documents_guard BEFORE INSERT OR UPDATE OR DELETE ON content.legal_documents
  FOR EACH ROW EXECUTE FUNCTION content.guard_legal_document();
--> statement-breakpoint
CREATE TRIGGER pages_touch BEFORE UPDATE ON content.pages
  FOR EACH ROW EXECUTE FUNCTION ops.touch_updated_at();
