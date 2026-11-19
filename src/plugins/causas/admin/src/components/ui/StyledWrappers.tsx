import styled from 'styled-components';
import { Box } from '@strapi/design-system';
import { IMaskInput } from 'react-imask';

export const GroupInput = styled.div<{ marginTop?: number }>`
  width: 100%;
  margin-top: ${({ marginTop = 0 }) => `${marginTop}px`};
`;

export const IMaskInputWrapper = styled(Box)`
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: #ffffff;
  padding-inline-start: 0;
  position: relative;
  outline: none;
  box-shadow: none;
  transition: border-color 0.2s, box-shadow 0.2s;
  &:focus-within {
    border-color: #b49a3a;
    box-shadow: 0 0 0 3px rgba(180, 154, 58, 0.15);
  }
`;

export const IMaskStyledInput = styled(IMaskInput)`
  border: none;
  border-radius: 6px;
  color: #1f2937;
  font-weight: 400;
  font-size: 0.875rem;
  line-height: 1.5;
  display: block;
  width: 100%;
  background: inherit;
  padding: 10px 14px;
  font-family: 'Inter', sans-serif;
  &:focus {
    outline: none;
  }
`;

export const Fieldset = styled.fieldset`
  width: 100%;
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 24px;
  margin-top: 16px;
  transition: box-shadow 0.2s;
  &:hover {
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  }
  legend {
    font-size: 0.8rem;
    font-weight: 600;
    color: #374151;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 0 8px;
    background: #ffffff;
  }
`;

export const Ulparent = styled.ul`
  margin: 8px 0;
  font-size: 13px;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: 12px;
  background: #f9fafb;
  li {
    color: #059669;
    font-weight: 500;
    padding: 2px 0;
  }
  ul {
    margin-left: 16px;
    list-style: circle;
    li {
      color: #6b7280;
      font-weight: 400;
    }
  }
`;