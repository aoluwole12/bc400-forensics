--
-- PostgreSQL database dump
--

\restrict eD0a6GJquPgk6pw0CqmPndIcjesBUt6aNWHg4TjWgSHF4nAkUfyvZ1YyRHXikQI

-- Dumped from database version 16.11 (Debian 16.11-1.pgdg12+1)
-- Dumped by pg_dump version 16.11 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

-- *not* creating schema, since initdb creates it


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: addresses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.addresses (
    id integer NOT NULL,
    address text NOT NULL
);


--
-- Name: addresses_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.addresses_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: addresses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.addresses_id_seq OWNED BY public.addresses.id;


--
-- Name: holder_balances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.holder_balances (
    address_id integer NOT NULL,
    balance_raw numeric NOT NULL,
    balance_bc400 numeric NOT NULL,
    tx_count integer NOT NULL,
    tags text DEFAULT 'none'::text NOT NULL,
    first_seen timestamp with time zone NOT NULL,
    last_seen timestamp with time zone NOT NULL,
    last_block_number bigint,
    last_block_time timestamp with time zone,
    last_tx_hash text
);


--
-- Name: meta; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.meta (
    key text NOT NULL,
    value text NOT NULL
);


--
-- Name: transfers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transfers (
    tx_hash text NOT NULL,
    log_index integer NOT NULL,
    block_number bigint NOT NULL,
    block_time timestamp with time zone NOT NULL,
    from_address_id integer NOT NULL,
    to_address_id integer NOT NULL,
    raw_amount text NOT NULL
);


--
-- Name: addresses id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.addresses ALTER COLUMN id SET DEFAULT nextval('public.addresses_id_seq'::regclass);


--
-- Name: addresses addresses_address_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.addresses
    ADD CONSTRAINT addresses_address_key UNIQUE (address);


--
-- Name: addresses addresses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.addresses
    ADD CONSTRAINT addresses_pkey PRIMARY KEY (id);


--
-- Name: holder_balances holder_balances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.holder_balances
    ADD CONSTRAINT holder_balances_pkey PRIMARY KEY (address_id);


--
-- Name: meta meta_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meta
    ADD CONSTRAINT meta_pkey PRIMARY KEY (key);


--
-- Name: transfers transfers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transfers
    ADD CONSTRAINT transfers_pkey PRIMARY KEY (tx_hash, log_index);


--
-- Name: holder_balances holder_balances_address_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.holder_balances
    ADD CONSTRAINT holder_balances_address_id_fkey FOREIGN KEY (address_id) REFERENCES public.addresses(id) ON DELETE CASCADE;


--
-- Name: transfers transfers_from_address_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transfers
    ADD CONSTRAINT transfers_from_address_id_fkey FOREIGN KEY (from_address_id) REFERENCES public.addresses(id);


--
-- Name: transfers transfers_to_address_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transfers
    ADD CONSTRAINT transfers_to_address_id_fkey FOREIGN KEY (to_address_id) REFERENCES public.addresses(id);


--
-- PostgreSQL database dump complete
--

\unrestrict eD0a6GJquPgk6pw0CqmPndIcjesBUt6aNWHg4TjWgSHF4nAkUfyvZ1YyRHXikQI

