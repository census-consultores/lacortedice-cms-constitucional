import { Grid, TextInput, Typography } from '@strapi/design-system';
import { Fieldset, GroupInput } from '../ui/StyledWrappers';
import { FastField, FieldProps } from 'formik';
import { IMaskInputWrapper, IMaskStyledInput } from '../ui/StyledWrappers';

const CuantiaDelCaso = () => {
    const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
        e.preventDefault();
        const pastedText = e.clipboardData.getData('text');
        // Primero reemplazamos la coma decimal por punto
        const withDot = pastedText.replace(',', '.');
        // Eliminamos los puntos de mil y dejamos el último como decimal
        const cleanValue = withDot.replace(/\.(?=.*\.)/g, '');
        // Simula la escritura del valor limpio
        const input = e.target as HTMLInputElement;
        input.value = cleanValue;
        // Dispara el evento input para que IMask lo procese
        input.dispatchEvent(new Event('input', { bubbles: true }));
    };

    return (
        <Fieldset>
            <legend>Aspectos económicos</legend>
            <Grid.Root gap={5}>
                <Grid.Item xs={12} col={6}>
                    <GroupInput>
                        <Typography variant="pi" fontWeight="bold" textColor="neutral800" as="label">
                            Cuantía
                        </Typography>
                        <FastField name="cuantia">
                            {({ field, meta, form }: FieldProps) => (
                                <IMaskInputWrapper>
                                    <IMaskStyledInput
                                        mask="num"
                                        blocks={{
                                            num: {
                                                mask: Number,
                                                thousandsSeparator: '.',
                                                radix: ',',
                                                scale: 2,
                                                padFractionalZeros: true,
                                                normalizeZeros: true,
                                                min: 0,
                                                max: 999999999
                                            },
                                        }}
                                        value={field.value}
                                        defaultValue={field.value}
                                        onAccept={(value: string) => form.setFieldValue(field.name, value)}
                                        onBlur={field.onBlur}
                                        onPaste={handlePaste}
                                        name={field.name}
                                        placeholder="$0.00"
                                    />
                                </IMaskInputWrapper>
                            )}
                        </FastField>
                    </GroupInput>
                </Grid.Item>
                <Grid.Item xs={12} col={6}>
                    <GroupInput>
                        <Typography variant="pi" fontWeight="bold" textColor="neutral800" as="label">
                            Detalle de la cuantía
                        </Typography>
                        <FastField name="detalle_cuantia">
                            {({ field }: FieldProps) => (
                                <TextInput
                                    {...field}
                                    placeholder="Monto total en controversia"
                                    style={{ fontSize: '1.2rem' }}
                                />
                            )}
                        </FastField>
                    </GroupInput>
                </Grid.Item>
            </Grid.Root>
        </Fieldset>
    )
}

export default CuantiaDelCaso;